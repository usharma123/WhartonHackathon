import type { ReviewGapAIClient } from "./ai.js";
import {
  analyzeReviewWithFallback,
  extractAnswerFactsWithFallback,
  generateClarifierWithFallback,
  generateEnhancedReviewWithFallback,
  generateQuestionWithFallback,
  sourceDiagnostics,
} from "./ai.js";
import type { FacetClassifierArtifact } from "./ml.js";
import type { RuntimeFacet } from "./facets.js";
import {
  buildFacetEvidenceFromReviewSnippets,
  buildFirstPartyLiveReviewSample,
  combineSourceAwareLiveSignals,
} from "./propertySource.js";
import { normalizeConflict, rankFacetMetrics } from "./scoring.js";
import type {
  AspectRatings,
  AnalyzeDraftReviewInput,
  ConfirmEnhancedReviewInput,
  CreateReviewSessionInput,
  CreateReviewSessionResult,
  EditedFactInput,
  FactCandidate,
  FinalizeReviewPreviewInput,
  FinalizeReviewPreviewResult,
  LearnedRankerArtifact,
  PropertyEvidenceUpdate,
  PropertyFacetMetric,
  RankerSource,
  ScoreBreakdown,
  SelectNextQuestionInput,
  SelectNextQuestionResult,
  SessionSummary,
  SessionSentiment,
  StructuredFact,
  SubmitFollowUpAnswerInput,
  SubmitFollowUpAnswerResult,
  StayLengthBucket,
  TripContext,
  TripType,
} from "./types.js";
import { summarizeEligibleFacet } from "./runtimeBundle.js";
import type { ReviewGapStore } from "./store.js";
import { buildWhyThisQuestion } from "./whyThisQuestion.js";

const MAX_TOTAL_FOLLOW_UP_TURNS = 2;

export async function createReviewSession(
  store: ReviewGapStore,
  input: CreateReviewSessionInput,
  classifierArtifact?: FacetClassifierArtifact,
): Promise<CreateReviewSessionResult> {
  const property = await requireProperty(store, input.propertyId);
  const metrics = await store.listPropertyFacetMetrics(input.propertyId);
  const eligibleFacets = rankFacetMetrics(
    metrics,
    { mentionedFacets: [], likelyKnownFacets: [] },
    { includeSecondaryFacets: false },
  ).map((candidate) => summarizeEligibleFacet(candidate.metric));

  const now = store.now();
  const session = await store.createReviewSession({
    propertyId: input.propertyId,
    tokenIdentifier: input.tokenIdentifier,
    draftReview: input.draftReview ?? "",
    conversationStage: "collecting_review",
    clarifierCount: 0,
    overallRating: undefined,
    aspectRatings: undefined,
    selectedFacet: null,
    mentionedFacets: [],
    likelyKnownFacets: [],
    mlMentionProbByFacet: {},
    mlLikelyKnownByFacet: {},
    usedML: false,
    usedOpenAI: false,
    usedFallback: false,
    sentiment: "neutral",
    tripContext: undefined,
    createdAt: now,
    updatedAt: now,
  });

  return {
    sessionId: session.id,
    propertySummary: property,
    eligibleFacets,
  };
}

export async function analyzeDraftReview(
  store: ReviewGapStore,
  aiClient: ReviewGapAIClient | undefined,
  input: AnalyzeDraftReviewInput,
  classifierArtifact?: FacetClassifierArtifact,
) {
  const session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const metrics = await store.listPropertyFacetMetrics(session.propertyId);
  const eligibleFacets = metrics.map((metric) => metric.facet);

  const analysis = await analyzeReviewWithFallback(aiClient, {
    draftReview: input.draftReview,
    eligibleFacets,
    property,
    classifierArtifact,
  });

  await store.updateReviewSession(session.id, {
    draftReview: input.draftReview,
    mentionedFacets: analysis.mentionedFacets,
    likelyKnownFacets: analysis.likelyKnownFacets,
    mlMentionProbByFacet: analysis.mlMentionProbByFacet,
    mlLikelyKnownByFacet: analysis.mlLikelyKnownByFacet,
    usedML: analysis.usedML,
    usedOpenAI: analysis.usedOpenAI,
    usedFallback: analysis.usedFallback,
    sentiment: analysis.sentiment,
    updatedAt: store.now(),
  });

  return analysis;
}

export async function selectNextQuestion(
  store: ReviewGapStore,
  aiClient: ReviewGapAIClient | undefined,
  input: SelectNextQuestionInput,
  classifierArtifact?: FacetClassifierArtifact,
  learnedRankerArtifact?: LearnedRankerArtifact,
): Promise<SelectNextQuestionResult> {
  const session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const priorAnswers = await store.listFollowUpAnswers(session.id);
  const analysis = await analyzeDraftReview(
    store,
    aiClient,
    {
      sessionId: session.id,
      draftReview: input.draftReview,
    },
    classifierArtifact,
  );
  const totalFollowUpTurns = session.clarifierCount + priorAnswers.length;

  if (totalFollowUpTurns >= MAX_TOTAL_FOLLOW_UP_TURNS) {
    return buildNoFollowUpResult(analysis, {
      assistantText:
        "I have enough to draft the review from what you've already shared.",
      whyThisQuestion:
        "The session already used the maximum of two follow-up turns, so the flow is moving to drafting.",
    });
  }

  if (!analysis.reviewReady && analysis.readinessReason) {
    const useFixedPrompt = session.clarifierCount >= MAX_TOTAL_FOLLOW_UP_TURNS - 1;
    const clarifier = await generateClarifierWithFallback(aiClient, {
      draftReview: input.draftReview,
      property,
      readinessReason: analysis.readinessReason,
      useFixedPrompt,
    });
    const updatedAt = store.now();
    await store.updateReviewSession(session.id, {
      draftReview: input.draftReview,
      conversationStage: "collecting_review",
      clarifierCount: Math.min(
        session.clarifierCount + 1,
        MAX_TOTAL_FOLLOW_UP_TURNS,
      ),
      selectedFacet: null,
      updatedAt,
    });
    return {
      turnType: "clarify_review",
      assistantText: clarifier.assistantText,
      readinessReason: analysis.readinessReason,
      facet: null,
      questionText: null,
      voiceText: null,
      whyThisQuestion:
        "The draft is still too thin to ask a property-specific follow-up question.",
      scoreBreakdown: null,
      supportingEvidence: [],
      analysis,
      questionSource: sourceDiagnostics({
        usedOpenAI: !clarifier.usedFallback,
        usedFallback: clarifier.usedFallback,
      }),
      noFollowUp: false,
    };
  }

  const metrics = await store.listPropertyFacetMetrics(session.propertyId);
  const heuristicRanked = rankFacetMetrics(metrics, analysis, {
    includeSecondaryFacets: input.includeSecondaryFacets ?? false,
    rankerSource: "heuristic",
  });
  const learnedRanked = learnedRankerArtifact
    ? rankFacetMetrics(metrics, analysis, {
        includeSecondaryFacets: input.includeSecondaryFacets ?? false,
        learnedArtifact: learnedRankerArtifact,
        rankerSource:
          learnedRankerArtifact.modelKind === "tree" ? "learned_tree" : "learned_linear",
      })
    : [];
  const servedRanked = learnedRanked.length > 0 ? learnedRanked : heuristicRanked;
  const top = chooseNextFacetCandidate(servedRanked, priorAnswers, analysis.sentiment);
  await store.createRankerShadowEvent({
    sessionId: session.id,
    propertyId: property.propertyId,
    draftReviewHash: stableDraftHash(input.draftReview),
    heuristicTop3: heuristicRanked.slice(0, 3).map((candidate) => candidate.facet),
    learnedTop3: learnedRanked.slice(0, 3).map((candidate) => candidate.facet),
    servedTop3: servedRanked.slice(0, 3).map((candidate) => candidate.facet),
    finalServedFacet: top?.facet ?? null,
    rankerSource: inferServedRankerSource(top?.scoreBreakdown),
    baseModelVersion: top?.scoreBreakdown.baseModelVersion,
    disagreed: compareFacetOrders(heuristicRanked, learnedRanked),
    createdAt: store.now(),
  });

  if (!top) {
    await store.updateReviewSession(session.id, {
      selectedFacet: null,
      conversationStage: "collecting_review",
      updatedAt: store.now(),
    });
    return buildNoFollowUpResult(analysis, {
      assistantText:
        "I have enough to draft the review without another follow-up question.",
      whyThisQuestion:
        "No eligible follow-up remained after the MVP allow-list, reliability, and coverage checks.",
    });
  }

  const supportingEvidence = (
    await store.listPropertyFacetEvidence(property.propertyId, top.facet)
  ).slice(0, 3);
  const whyThisQuestion = buildWhyThisQuestion(
    top.facet,
    top.scoreBreakdown,
    supportingEvidence,
  );
  const question = await generateQuestionWithFallback(aiClient, {
    facet: top.facet,
    property,
    supportingEvidence,
    draftReview: input.draftReview,
  });
  const createdAt = store.now();

  await store.createFollowUpQuestion({
    sessionId: session.id,
    facet: top.facet,
    questionText: question.questionText,
    voiceText: question.voiceText,
    whyThisQuestion,
    scoreBreakdown: top.scoreBreakdown,
    supportingEvidence,
    usedOpenAI: !question.usedFallback,
    usedFallback: question.usedFallback,
    createdAt,
  });

  await store.updateReviewSession(session.id, {
    draftReview: input.draftReview,
    conversationStage: "facet_followup",
    selectedFacet: top.facet,
    updatedAt: createdAt,
  });

  return {
    turnType: "facet_followup",
    assistantText: question.questionText,
    readinessReason: null,
    facet: top.facet,
    questionText: question.questionText,
    voiceText: question.voiceText,
    whyThisQuestion,
    scoreBreakdown: top.scoreBreakdown,
    supportingEvidence,
    analysis,
    questionSource: sourceDiagnostics({
      usedOpenAI: !question.usedFallback,
      usedFallback: question.usedFallback,
    }),
    noFollowUp: false,
  };
}

export async function submitFollowUpAnswer(
  store: ReviewGapStore,
  input: SubmitFollowUpAnswerInput,
): Promise<SubmitFollowUpAnswerResult> {
  const session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const createdAt = store.now();
  const extraction = await extractAnswerFactsWithFallback(undefined, {
    facet: input.facet,
    property,
    answerText: input.answerText,
  });

  await store.createFollowUpAnswer({
    sessionId: session.id,
    facet: input.facet,
    answerText: input.answerText,
    structuredFacts: extraction.structuredFacts,
    confidence: extraction.confidence,
    usedOpenAI: false,
    usedFallback: extraction.usedFallback,
    createdAt,
  });
  const answers = await store.listFollowUpAnswers(session.id);

  await store.updateReviewSession(session.id, {
    conversationStage: "facet_followup",
    selectedFacet: input.facet,
    updatedAt: createdAt,
  });

  return {
    answerRecorded: true,
    answerCount: answers.length,
  };
}

export async function finalizeReviewPreview(
  store: ReviewGapStore,
  aiClient: ReviewGapAIClient | undefined,
  input: FinalizeReviewPreviewInput,
): Promise<FinalizeReviewPreviewResult> {
  let session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const answers = await store.listFollowUpAnswers(session.id);
  const relevantAnswers = answers.filter((answer) => !isUnknownAnswer(answer.answerText));
  const updatedAt = store.now();
  const inferredRatings = inferStructuredRatings(
    input.draftReview,
    relevantAnswers.map((answer) => answer.answerText),
  );
  const nextOverallRating = session.overallRating ?? inferredRatings.overallRating;
  const nextAspectRatings = session.aspectRatings ?? inferredRatings.aspectRatings;

  session = await store.updateReviewSession(session.id, {
    draftReview: input.draftReview,
    conversationStage: "awaiting_confirmation",
    selectedFacet: null,
    overallRating: nextOverallRating,
    aspectRatings: nextAspectRatings,
    tripContext: deriveTripContext(input.draftReview, relevantAnswers.map((answer) => answer.answerText)),
    updatedAt,
  });

  const extractedAnswerFacts = relevantAnswers.flatMap((answer) =>
    answer.structuredFacts.length > 0
      ? answer.structuredFacts.map((fact) => ({
          fact,
          source: "follow_up_answer" as const,
          sourceText: answer.answerText,
        }))
      : [],
  );
  const draftFacts = extractDraftReviewFacts(input.draftReview).map((fact) => ({
    fact,
    source: "draft_review" as const,
    sourceText: String(fact.sourceSnippet ?? fact.value),
  }));
  const factCandidates = [...draftFacts, ...extractedAnswerFacts].map((entry, index) =>
    buildFactCandidate(entry.fact, entry.source, entry.sourceText, index),
  );
  const confirmedFacts = factCandidates
    .filter((candidate) => candidate.selectedByDefault)
    .map(factCandidateToStructuredFact);
  const tripContext = deriveTripContext(
    input.draftReview,
    relevantAnswers.map((answer) => answer.answerText),
  );

  const preview = await generateEnhancedReviewWithFallback(aiClient, {
    draftReview: input.draftReview,
    answers: relevantAnswers.map((answer) => ({ facet: answer.facet, answerText: answer.answerText })),
    structuredFacts: confirmedFacts,
    overallRating: nextOverallRating,
    aspectRatings: nextAspectRatings,
    revisionNotes: input.revisionNotes,
  });

  return {
    reviewText: preview.reviewText,
    factCandidates,
    tripContext,
    overallRating: nextOverallRating,
    aspectRatings: nextAspectRatings,
    usedOpenAI: preview.usedOpenAI,
    usedFallback: preview.usedFallback,
    confirmationPrompt:
      "Review the captured facts below, uncheck anything inaccurate, edit what needs fixing, then submit the review.",
  };
}

export async function confirmEnhancedReview(
  store: ReviewGapStore,
  input: ConfirmEnhancedReviewInput & { tokenIdentifier: string },
  sourceReviewAggregate?: { guestRating?: number; reviewCount: number },
  classifierArtifact?: FacetClassifierArtifact,
): Promise<void> {
  let session = await requireSession(store, input.sessionId);
  if (typeof session.overallRating !== "number") {
    const answers = await store.listFollowUpAnswers(input.sessionId);
    const inferredRatings = inferStructuredRatings(
      session.draftReview,
      [
        ...answers.map((answer) => answer.answerText),
        input.finalReviewText,
      ],
    );
    if (typeof inferredRatings.overallRating === "number") {
      session = await store.updateReviewSession(input.sessionId, {
        overallRating: inferredRatings.overallRating,
        aspectRatings: session.aspectRatings ?? inferredRatings.aspectRatings,
        updatedAt: store.now(),
      });
    }
  }
  if (typeof session.overallRating !== "number") {
    throw new Error("Overall rating is required before saving the review.");
  }
  const confirmedFacts = resolveConfirmedFacts(
    input.factCandidates,
    input.confirmedFactIds,
    input.editedFacts ?? [],
  );
  await persistConfirmedReview(
    store,
    input.sessionId,
    input.tokenIdentifier,
    input.finalReviewText,
    confirmedFacts,
    sourceReviewAggregate,
    classifierArtifact,
  );
  await store.updateReviewSession(input.sessionId, {
    conversationStage: "complete",
    selectedFacet: null,
    updatedAt: store.now(),
  });
}

export async function getSessionSummary(
  store: ReviewGapStore,
  sessionId: string,
): Promise<SessionSummary> {
  const session = await requireSession(store, sessionId);
  const question = await store.getLatestFollowUpQuestion(sessionId);
  const answer = await store.getLatestFollowUpAnswer(sessionId);
  const updates = await store.listPropertyEvidenceUpdatesBySession(sessionId);

  return {
    draftReview: session.draftReview,
    selectedFacet: session.selectedFacet,
    askedQuestion: question,
    answer,
    extractedFacts: answer?.structuredFacts ?? [],
    accumulatedEvidenceUpdates: updates,
  };
}

async function requireProperty(store: ReviewGapStore, propertyId: string) {
  const property = await store.getProperty(propertyId);
  if (!property) {
    throw new Error(`Unknown property ${propertyId}`);
  }
  return property;
}

async function requireSession(store: ReviewGapStore, sessionId: string) {
  const session = await store.getReviewSession(sessionId);
  if (!session) {
    throw new Error(`Unknown review session ${sessionId}`);
  }
  return session;
}

async function syncFirstPartyReviewState(
  store: ReviewGapStore,
  sessionId: string,
  tokenIdentifier: string,
  finalReviewText: string,
  structuredFacts: StructuredFact[],
  sourceReviewAggregate?: { guestRating?: number; reviewCount: number },
  classifierArtifact?: FacetClassifierArtifact,
): Promise<void> {
  const session = await requireSession(store, sessionId);
  const property = await requireProperty(store, session.propertyId);
  const answers = await store.listFollowUpAnswers(sessionId);
  if (!finalReviewText.trim()) {
    return;
  }

  const createdAt = session.createdAt;
  const updatedAt = store.now();
  const tripContext =
    session.tripContext ??
    deriveTripContext(finalReviewText, answers.map((answer) => answer.answerText));
  const vendorReviews = (await store.listPropertyLiveReviews(session.propertyId)).filter(
    (review) => review.sourceVendor === "expedia",
  );
  const priorVersion = property.recomputeSourceVersion ?? 0;

  await store.patchProperty(session.propertyId, {
    recomputeStatus: "recomputing",
  });

  await store.upsertUserPropertyReview({
    propertyId: session.propertyId,
    tokenIdentifier,
    sessionId,
    reviewText: finalReviewText,
    overallRating: session.overallRating,
    aspectRatings: session.aspectRatings,
    sentiment: session.sentiment,
    answerCount: answers.length,
    factCount: structuredFacts.length,
    tripContext,
    submissionCount: 1,
    createdAt,
    updatedAt,
  });

  const evidenceUpdates: Array<Omit<PropertyEvidenceUpdate, "id">> = structuredFacts.map((fact) => ({
    propertyId: property.propertyId,
    facet: fact.facet,
    factType: fact.factType,
    value: fact.value,
    confidence: fact.confidence,
    sourceSessionId: session.id,
    createdAt: updatedAt,
    rawFact: fact,
  }));

  if (evidenceUpdates.length > 0) {
    await store.appendPropertyEvidenceUpdates(evidenceUpdates);
  }

  await store.upsertPropertyLiveReview(
    buildFirstPartyLiveReviewSample({
      propertyId: session.propertyId,
      tokenIdentifier,
      sessionId,
      text: finalReviewText,
      reviewDate: updatedAt,
    }),
  );

  const liveReviews = await store.listPropertyLiveReviews(session.propertyId);
  const firstPartyReviews = liveReviews.filter((review) => review.sourceVendor === "first_party");
  const liveSignals = combineSourceAwareLiveSignals({
    propertyId: session.propertyId,
    facetListingTexts: property.facetListingTexts,
    vendorReviews: vendorReviews.map((review) => ({
      headline: review.headline,
      text: review.text,
      reviewDate: review.reviewDate,
    })),
    firstPartyReviews: firstPartyReviews.map((review) => ({
      headline: review.headline,
      text: review.text,
      reviewDate: review.reviewDate,
    })),
    classifierArtifact,
    fetchedAt: updatedAt,
  });
  await store.replacePropertyFacetLiveSignals(session.propertyId, liveSignals);

  const firstPartyEvidence = buildFacetEvidenceFromReviewSnippets(
    session.propertyId,
    "first_party_review",
    firstPartyReviews.map((review) => ({
      headline: review.headline,
      text: review.text,
      reviewDate: review.reviewDate,
    })),
    classifierArtifact,
  );
  for (const [facet, evidence] of Object.entries(firstPartyEvidence) as Array<
    [RuntimeFacet, (typeof firstPartyEvidence)[keyof typeof firstPartyEvidence]]
  >) {
    await store.replacePropertyFacetSourceEvidence(
      session.propertyId,
      facet,
      "first_party_",
      evidence,
    );
  }

  const firstPartySavedReviews = await store.listUserPropertyReviews(session.propertyId);
  const blendedGuestRating = computeBlendedGuestRating(
    sourceReviewAggregate?.guestRating,
    sourceReviewAggregate?.reviewCount ?? 0,
    firstPartySavedReviews,
  );

  await store.patchProperty(session.propertyId, {
    guestRating: blendedGuestRating,
    vendorReviewCount: sourceReviewAggregate?.reviewCount ?? vendorReviews.length,
    firstPartyReviewCount: firstPartySavedReviews.length,
    liveReviewCount: liveReviews.length,
    lastRecomputedAt: updatedAt,
    recomputeStatus: "ready",
    recomputeSourceVersion: priorVersion + 1,
  });

  await store.updateReviewSession(session.id, {
    tripContext,
    updatedAt,
  });
}

async function persistConfirmedReview(
  store: ReviewGapStore,
  sessionId: string,
  tokenIdentifier: string,
  finalReviewText: string,
  structuredFacts: StructuredFact[],
  sourceReviewAggregate?: { guestRating?: number; reviewCount: number },
  classifierArtifact?: FacetClassifierArtifact,
): Promise<void> {
  await syncFirstPartyReviewState(
    store,
    sessionId,
    tokenIdentifier,
    finalReviewText,
    structuredFacts,
    sourceReviewAggregate,
    classifierArtifact,
  );
}

function computeBlendedGuestRating(
  sourceGuestRating: number | undefined,
  sourceReviewCount: number,
  reviews: Array<{ overallRating?: number }>,
): number | undefined {
  const firstPartyRatings = reviews
    .map((review) => review.overallRating)
    .filter((rating): rating is number => typeof rating === "number" && Number.isFinite(rating));
  const firstPartyCount = firstPartyRatings.length;
  const firstPartyTotal = firstPartyRatings.reduce((sum, rating) => sum + rating, 0);
  const seedCount = Math.max(0, sourceReviewCount);
  const seedRating = typeof sourceGuestRating === "number" && Number.isFinite(sourceGuestRating)
    ? sourceGuestRating
    : undefined;

  if (firstPartyCount === 0) {
    return seedRating;
  }
  if (seedRating === undefined || seedCount === 0) {
    return roundRating(firstPartyTotal / firstPartyCount);
  }

  return roundRating(
    ((seedRating * seedCount) + firstPartyTotal) / (seedCount + firstPartyCount),
  );
}

function roundRating(value: number): number {
  return Math.round(value * 10) / 10;
}

function isUnknownAnswer(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^(i do not know|i don't know|dont know|don't know|not sure|unsure|no idea|unknown|n\/a)$/i.test(
    normalized,
  );
}

function extractDraftReviewFacts(draftReview: string): StructuredFact[] {
  const clauses = draftReview
    .split(/[.,;]+/)
    .map((clause) => clause.replace(/\s+/g, " ").trim())
    .filter((clause) => clause.length >= 12);
  const seen = new Set<string>();
  const facts: StructuredFact[] = [];

  for (const clause of clauses) {
    const normalized = clause.toLowerCase();
    if (isUnknownAnswer(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    facts.push({
      facet: inferFacetForDraftClause(normalized),
      factType: "review_detail",
      value: clause,
      confidence: 0.52,
      firsthandConfidence: 0.72,
      polarity: detectTextPolarity(clause),
      severity: inferSeverity(clause),
      resolved: detectResolvedState(clause),
      sourceSnippet: clause,
    });
    if (facts.length >= 4) {
      break;
    }
  }

  return facts;
}

function inferFacetForDraftClause(clause: string): RuntimeFacet {
  if (/\b(check[ -]?in|front desk|reception|lobby|key|arrival)\b/i.test(clause)) {
    return "check_in";
  }
  if (/\b(check[ -]?out|late checkout|checkout|departure|charge|fee)\b/i.test(clause)) {
    return "check_out";
  }
  if (/\b(parking|garage|valet|lot|shuttle)\b/i.test(clause)) {
    return "amenities_parking";
  }
  if (/\b(breakfast|buffet|coffee|continental)\b/i.test(clause)) {
    return "amenities_breakfast";
  }
  if (/\b(pool|hot tub|jacuzzi)\b/i.test(clause)) {
    return "amenities_pool";
  }
  return "know_before_you_go";
}

function buildFactCandidate(
  fact: StructuredFact,
  source: FactCandidate["source"],
  sourceText: string,
  index: number,
): FactCandidate {
  return {
    ...fact,
    id: stableFactCandidateId(fact, source, sourceText, index),
    source,
    sourceText,
    editable: true,
    selectedByDefault: fact.confidence >= 0.4 || fact.factType === "review_detail",
  };
}

function factCandidateToStructuredFact(candidate: FactCandidate): StructuredFact {
  return {
    facet: candidate.facet,
    factType: candidate.factType,
    value: candidate.value,
    confidence: candidate.confidence,
    firsthandConfidence: candidate.firsthandConfidence,
    polarity: candidate.polarity,
    severity: candidate.severity,
    resolved: candidate.resolved,
    sourceSnippet: candidate.sourceSnippet,
  };
}

function resolveConfirmedFacts(
  candidates: FactCandidate[],
  confirmedFactIds: string[],
  editedFacts: EditedFactInput[],
): StructuredFact[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
  const editedById = new Map(editedFacts.map((fact) => [fact.id, fact.value] as const));

  return confirmedFactIds
    .map((id) => {
      const candidate = candidateById.get(id);
      if (!candidate) {
        return null;
      }
      const editedValue = editedById.get(id);
      return factCandidateToStructuredFact({
        ...candidate,
        value:
          editedValue === undefined
            ? candidate.value
            : coerceEditedFactValue(candidate.value, editedValue),
      });
    })
    .filter((fact): fact is StructuredFact => fact !== null);
}

function coerceEditedFactValue(
  originalValue: StructuredFact["value"],
  editedValue: StructuredFact["value"],
): StructuredFact["value"] {
  if (typeof originalValue === "boolean") {
    if (typeof editedValue === "boolean") {
      return editedValue;
    }
    return /^(true|yes|y|1)$/i.test(String(editedValue).trim());
  }
  if (typeof originalValue === "number") {
    if (typeof editedValue === "number") {
      return editedValue;
    }
    const parsed = Number.parseFloat(String(editedValue).trim());
    return Number.isFinite(parsed) ? parsed : originalValue;
  }
  return String(editedValue).trim();
}

function stableFactCandidateId(
  fact: StructuredFact,
  source: FactCandidate["source"],
  sourceText: string,
  index: number,
): string {
  const raw = [source, fact.facet, fact.factType, String(fact.value), sourceText, index].join("|");
  let hash = 0;
  for (let pointer = 0; pointer < raw.length; pointer += 1) {
    hash = Math.imul(31, hash) + raw.charCodeAt(pointer);
  }
  return `fact_${Math.abs(hash).toString(36)}`;
}

function chooseNextFacetCandidate(
  ranked: Array<{ facet: RuntimeFacet; metric: PropertyFacetMetric; scoreBreakdown: ScoreBreakdown }>,
  answers: Array<{ facet: RuntimeFacet; answerText: string }>,
  sentiment: SessionSentiment,
) {
  if (ranked.length === 0 || answers.length >= MAX_TOTAL_FOLLOW_UP_TURNS) {
    return null;
  }
  const answeredFacets = new Set(answers.map((answer) => answer.facet));
  const remaining = ranked.filter((candidate) => !answeredFacets.has(candidate.facet));
  if (remaining.length === 0) {
    return null;
  }
  if (answers.length === 0) {
    return remaining[0] ?? null;
  }

  const answerPolarity = detectTextPolarity(answers.at(-1)?.answerText ?? "");
  const wantsPositiveBalance = answerPolarity === "negative" || sentiment === "negative";
  const sorted = [...remaining].sort((left, right) =>
    wantsPositiveBalance
      ? positiveBalanceScore(right) - positiveBalanceScore(left)
      : unresolvedNegativeScore(right) - unresolvedNegativeScore(left),
  );
  return sorted[0] ?? null;
}

function buildNoFollowUpResult(
  analysis: SelectNextQuestionResult["analysis"],
  details: {
    assistantText: string;
    whyThisQuestion: string;
  },
): SelectNextQuestionResult {
  return {
    turnType: "no_follow_up",
    assistantText: details.assistantText,
    readinessReason: null,
    facet: null,
    questionText: null,
    voiceText: null,
    whyThisQuestion: details.whyThisQuestion,
    scoreBreakdown: null,
    supportingEvidence: [],
    analysis,
    questionSource: null,
    noFollowUp: true,
  };
}

function compareFacetOrders(
  heuristicRanked: Array<{ facet: RuntimeFacet }>,
  learnedRanked: Array<{ facet: RuntimeFacet }>,
): boolean {
  if (learnedRanked.length === 0) {
    return false;
  }
  const heuristicTop = heuristicRanked.slice(0, 3).map((candidate) => candidate.facet);
  const learnedTop = learnedRanked.slice(0, 3).map((candidate) => candidate.facet);
  if (heuristicTop.length !== learnedTop.length) {
    return true;
  }
  return heuristicTop.some((facet, index) => learnedTop[index] !== facet);
}

function inferServedRankerSource(
  breakdown: Pick<ScoreBreakdown, "rankerSource"> | null | undefined,
): RankerSource {
  return breakdown?.rankerSource ?? "heuristic";
}

function stableDraftHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  let hash = 0;
  for (let pointer = 0; pointer < normalized.length; pointer += 1) {
    hash = Math.imul(33, hash) ^ normalized.charCodeAt(pointer);
  }
  return `draft_${Math.abs(hash).toString(36)}`;
}

function positiveBalanceScore(candidate: {
  metric: { mentionRate: number; importance: number; validatedConflictScore: number };
}) {
  return (
    candidate.metric.mentionRate * 0.45 +
    candidate.metric.importance * 0.35 -
    normalizeConflict(candidate.metric.validatedConflictScore) * 0.2
  );
}

function unresolvedNegativeScore(candidate: {
  metric: { validatedConflictScore: number; mentionRate: number; stalenessScore: number; importance: number };
}) {
  return (
    normalizeConflict(candidate.metric.validatedConflictScore) * 0.45 +
    (1 - candidate.metric.mentionRate) * 0.2 +
    candidate.metric.stalenessScore * 0.15 +
    candidate.metric.importance * 0.2
  );
}

function deriveTripContext(
  draftReview: string,
  answers: string[],
): TripContext | undefined {
  const combined = [draftReview, ...answers].join(" ").toLowerCase();
  const tripType = inferTripType(combined);
  const stayLengthBucket = inferStayLengthBucket(combined);
  const arrivalTimeBucket = inferArrivalTimeBucket(combined);
  const roomType = inferRoomType(combined);
  const context: TripContext = {
    ...(tripType ? { tripType } : {}),
    ...(stayLengthBucket ? { stayLengthBucket } : {}),
    ...(arrivalTimeBucket ? { arrivalTimeBucket } : {}),
    ...(roomType ? { roomType } : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

function inferTripType(text: string): TripType | undefined {
  if (/\b(work|conference|client|meeting|business)\b/.test(text)) return "business";
  if (/\b(husband|wife|partner|boyfriend|girlfriend|anniversary|date night)\b/.test(text)) {
    return "couple";
  }
  if (/\b(kids|children|family|daughter|son)\b/.test(text)) return "family";
  if (/\b(friend|friends|group)\b/.test(text)) return "friends";
  if (/\b(i|me|myself|solo)\b/.test(text)) return "solo";
  return undefined;
}

function inferStayLengthBucket(text: string): StayLengthBucket | undefined {
  if (/\b(4|5|6|7|8|9|10|\d{2,})\s+(night|nights|day|days)\b/.test(text)) {
    return "4_plus_nights";
  }
  if (/\b(2|3)\s+(night|nights|day|days)\b/.test(text)) {
    return "2_3_nights";
  }
  if (/\b(one|1)\s+(night|day)\b|\bovernight\b/.test(text)) {
    return "1_night";
  }
  return undefined;
}

function inferArrivalTimeBucket(text: string): TripContext["arrivalTimeBucket"] {
  const explicitHour = text.match(/\b(\d{1,2})(?::\d{2})?\s?(am|pm)\b/);
  if (explicitHour) {
    const hour = Number.parseInt(explicitHour[1]!, 10);
    const meridiem = explicitHour[2]!.toLowerCase();
    const normalized = meridiem === "pm" && hour < 12 ? hour + 12 : meridiem === "am" && hour === 12 ? 0 : hour;
    if (normalized < 12) return "morning";
    if (normalized < 17) return "afternoon";
    if (normalized < 22) return "evening";
    return "late_night";
  }
  if (/\bmorning\b/.test(text)) return "morning";
  if (/\bafternoon\b/.test(text)) return "afternoon";
  if (/\bevening\b/.test(text)) return "evening";
  if (/\b(late|midnight|night)\b/.test(text)) return "late_night";
  return undefined;
}

function inferRoomType(text: string): string | undefined {
  const match = text.match(
    /\b(king room|double room|suite|queen room|standard room|deluxe room|accessible room|studio)\b/i,
  );
  return match?.[1]?.trim();
}

function detectTextPolarity(text: string): SessionSentiment {
  const normalized = text.toLowerCase();
  const positive = /\b(great|good|easy|smooth|friendly|clean|comfortable|excellent|amazing)\b/.test(
    normalized,
  );
  const negative = /\b(bad|poor|dirty|wait|slow|rude|problem|issue|noisy|fee|charge|frustrating|disappointed)\b/.test(
    normalized,
  );
  if (positive && negative) return "mixed";
  if (negative) return "negative";
  if (positive) return "positive";
  return "neutral";
}

function inferSeverity(text: string): "low" | "medium" | "high" {
  const normalized = text.toLowerCase();
  if (/\b(stole|unsafe|filthy|bugs|bed bugs|charged twice|disaster)\b/.test(normalized)) {
    return "high";
  }
  if (/\b(wait|dirty|rude|issue|problem|closed|fee|charge|noisy)\b/.test(normalized)) {
    return "medium";
  }
  return "low";
}

function detectResolvedState(text: string): boolean | undefined {
  const normalized = text.toLowerCase();
  if (/\b(fixed|resolved|sorted out|made it right|eventually helped)\b/.test(normalized)) {
    return true;
  }
  if (/\b(still|never|didn't|did not|wasn't|was not|unresolved)\b/.test(normalized)) {
    return false;
  }
  return undefined;
}

export async function updateStructuredReview(
  store: ReviewGapStore,
  input: { sessionId: string; overallRating: number; aspectRatings?: AspectRatings },
) {
  const session = await requireSession(store, input.sessionId);
  if (!Number.isFinite(input.overallRating) || input.overallRating < 1 || input.overallRating > 10) {
    throw new Error("Overall rating must be between 1 and 10.");
  }
  return store.updateReviewSession(session.id, {
    overallRating: input.overallRating,
    aspectRatings: normalizeAspectRatings(input.aspectRatings),
    updatedAt: store.now(),
  });
}

function normalizeAspectRatings(
  aspectRatings: AspectRatings | undefined,
): AspectRatings | undefined {
  if (!aspectRatings) {
    return undefined;
  }
  const normalized = Object.fromEntries(
    Object.entries(aspectRatings).filter(
      ([, value]) => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5,
    ),
  ) as AspectRatings;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function inferStructuredRatings(
  primaryText: string,
  secondaryTexts: string[] = [],
): { overallRating?: number; aspectRatings?: AspectRatings } {
  const text = [primaryText, ...secondaryTexts]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ");

  if (!text) {
    return {};
  }

  const overallMatch = text.match(/\b(10|[1-9])\s*\/\s*10\b|\b(10|[1-9])\s+out of\s+10\b/i);
  const overallCandidate = overallMatch
    ? Number.parseInt((overallMatch[1] ?? overallMatch[2]) as string, 10)
    : undefined;
  const overallRating =
    typeof overallCandidate === "number" && Number.isFinite(overallCandidate)
      ? overallCandidate
      : undefined;

  const aspectMatchers: Array<[keyof AspectRatings, RegExp]> = [
    ["service", /\bservice\b\s*[:=-]?\s*(5|[1-4])\s*\/\s*5\b/i],
    ["cleanliness", /\bcleanliness\b\s*[:=-]?\s*(5|[1-4])\s*\/\s*5\b/i],
    ["amenities", /\bamenities\b\s*[:=-]?\s*(5|[1-4])\s*\/\s*5\b/i],
    ["value", /\bvalue\b\s*[:=-]?\s*(5|[1-4])\s*\/\s*5\b/i],
  ];
  const aspectRatings = normalizeAspectRatings(
    Object.fromEntries(
      aspectMatchers.flatMap(([key, pattern]) => {
        const match = text.match(pattern);
        if (!match) {
          return [];
        }
        const value = Number.parseInt(match[1]!, 10);
        return Number.isFinite(value) ? [[key, value]] : [];
      }),
    ) as AspectRatings,
  );

  return {
    ...(typeof overallRating === "number" ? { overallRating } : {}),
    ...(aspectRatings ? { aspectRatings } : {}),
  };
}

export type { RuntimeFacet };
