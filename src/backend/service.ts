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
  deriveLiveFacetSignalsFromReviewSnippets,
} from "./propertySource.js";
import { rankFacetMetrics } from "./scoring.js";
import type {
  AspectRatings,
  AnalyzeDraftReviewInput,
  ConfirmEnhancedReviewInput,
  CreateReviewSessionInput,
  CreateReviewSessionResult,
  FinalizeReviewPreviewInput,
  FinalizeReviewPreviewResult,
  PropertyEvidenceUpdate,
  SelectNextQuestionInput,
  SelectNextQuestionResult,
  SessionSummary,
  StructuredFact,
  SubmitFollowUpAnswerInput,
  SubmitFollowUpAnswerResult,
} from "./types.js";
import { summarizeEligibleFacet } from "./runtimeBundle.js";
import type { ReviewGapStore } from "./store.js";
import { buildWhyThisQuestion } from "./whyThisQuestion.js";

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
): Promise<SelectNextQuestionResult> {
  const session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const analysis = await analyzeDraftReview(
    store,
    aiClient,
    {
      sessionId: session.id,
      draftReview: input.draftReview,
    },
    classifierArtifact,
  );

  if (!analysis.reviewReady && analysis.readinessReason) {
    const useFixedPrompt = session.clarifierCount >= 2;
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
      clarifierCount: Math.min(session.clarifierCount + 1, 2),
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
  const ranked = rankFacetMetrics(metrics, analysis, {
    includeSecondaryFacets: input.includeSecondaryFacets ?? false,
  });

  if (ranked.length === 0) {
    await store.updateReviewSession(session.id, {
      selectedFacet: null,
      conversationStage: "collecting_review",
      updatedAt: store.now(),
    });
    return {
      turnType: "no_follow_up",
      assistantText:
        "I have enough to draft the review without another follow-up question.",
      readinessReason: null,
      facet: null,
      questionText: null,
      voiceText: null,
      whyThisQuestion:
        "No eligible follow-up remained after the MVP allow-list, reliability, and coverage checks.",
      scoreBreakdown: null,
      supportingEvidence: [],
      analysis,
      questionSource: null,
      noFollowUp: true,
    };
  }

  const top = ranked[0];
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
  const createdAt = store.now();

  await store.createFollowUpAnswer({
    sessionId: session.id,
    facet: input.facet,
    answerText: input.answerText,
    structuredFacts: [],
    confidence: 0,
    usedOpenAI: false,
    usedFallback: true,
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
  const session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const answers = await store.listFollowUpAnswers(session.id);
  const relevantAnswers = answers.filter((answer) => !isUnknownAnswer(answer.answerText));
  const updatedAt = store.now();

  await store.updateReviewSession(session.id, {
    draftReview: input.draftReview,
    conversationStage: "awaiting_confirmation",
    selectedFacet: null,
    updatedAt,
  });

  const structuredFacts = (
    await Promise.all(
      relevantAnswers.map(async (answer) => {
        const extraction = await extractAnswerFactsWithFallback(undefined, {
          facet: answer.facet,
          property,
          answerText: answer.answerText,
        });
        return extraction.structuredFacts;
      }),
    )
  ).flat();
  const draftFacts = extractDraftReviewFacts(input.draftReview);
  const allStructuredFacts = [...draftFacts, ...structuredFacts];

  const preview = await generateEnhancedReviewWithFallback(aiClient, {
    draftReview: input.draftReview,
    answers: relevantAnswers.map((answer) => ({ facet: answer.facet, answerText: answer.answerText })),
    structuredFacts: allStructuredFacts,
    overallRating: session.overallRating,
    aspectRatings: session.aspectRatings,
    revisionNotes: input.revisionNotes,
  });

  return {
    reviewText: preview.reviewText,
    structuredFacts: allStructuredFacts,
    overallRating: session.overallRating,
    aspectRatings: session.aspectRatings,
    usedOpenAI: preview.usedOpenAI,
    usedFallback: preview.usedFallback,
    confirmationPrompt:
      "Does this reflect what you experienced? Reply yes to save it, or tell me what to change.",
  };
}

export async function confirmEnhancedReview(
  store: ReviewGapStore,
  input: ConfirmEnhancedReviewInput & { tokenIdentifier: string },
  sourceReviewAggregate?: { guestRating?: number; reviewCount: number },
  classifierArtifact?: FacetClassifierArtifact,
): Promise<void> {
  const session = await requireSession(store, input.sessionId);
  if (typeof session.overallRating !== "number") {
    throw new Error("Overall rating is required before saving the review.");
  }
  await persistConfirmedReview(
    store,
    input.sessionId,
    input.tokenIdentifier,
    input.finalReviewText,
    input.structuredFacts,
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
  const liveSignals = deriveLiveFacetSignalsFromReviewSnippets(
    session.propertyId,
    property.facetListingTexts,
    liveReviews.map((review) => ({
      headline: review.headline,
      text: review.text,
      reviewDate: review.reviewDate,
    })),
    classifierArtifact,
    updatedAt,
  );
  await store.replacePropertyFacetLiveSignals(session.propertyId, liveSignals);

  const firstPartyReviews = liveReviews.filter((review) => review.sourceVendor === "first_party");
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
    liveReviewCount: liveReviews.length,
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

export type { RuntimeFacet };
