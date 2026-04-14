import type { ReviewGapAIClient } from "./ai.js";
import {
  analyzeReviewWithFallback,
  extractAnswerFactsWithFallback,
  generateQuestionWithFallback,
} from "./ai.js";
import type { RuntimeFacet } from "./facets.js";
import { propertyCardDeltaSummary } from "./fallbacks.js";
import { rankFacetMetrics } from "./scoring.js";
import type {
  AnalyzeDraftReviewInput,
  CreateReviewSessionInput,
  CreateReviewSessionResult,
  PropertyEvidenceUpdate,
  SelectNextQuestionInput,
  SelectNextQuestionResult,
  SessionSummary,
  SubmitFollowUpAnswerInput,
  SubmitFollowUpAnswerResult,
} from "./types.js";
import { summarizeEligibleFacet } from "./runtimeBundle.js";
import type { ReviewGapStore } from "./store.js";
import { buildWhyThisQuestion } from "./whyThisQuestion.js";

export async function createReviewSession(
  store: ReviewGapStore,
  input: CreateReviewSessionInput,
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
    draftReview: input.draftReview ?? "",
    selectedFacet: null,
    mentionedFacets: [],
    likelyKnownFacets: [],
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
) {
  const session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const metrics = await store.listPropertyFacetMetrics(session.propertyId);
  const eligibleFacets = metrics.map((metric) => metric.facet);

  const analysis = await analyzeReviewWithFallback(aiClient, {
    draftReview: input.draftReview,
    eligibleFacets,
    property,
  });

  await store.updateReviewSession(session.id, {
    draftReview: input.draftReview,
    mentionedFacets: analysis.mentionedFacets,
    likelyKnownFacets: analysis.likelyKnownFacets,
    sentiment: analysis.sentiment,
    updatedAt: store.now(),
  });

  return analysis;
}

export async function selectNextQuestion(
  store: ReviewGapStore,
  aiClient: ReviewGapAIClient | undefined,
  input: SelectNextQuestionInput,
): Promise<SelectNextQuestionResult> {
  const session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const analysis = await analyzeDraftReview(store, aiClient, {
    sessionId: session.id,
    draftReview: input.draftReview,
  });
  const metrics = await store.listPropertyFacetMetrics(session.propertyId);
  const ranked = rankFacetMetrics(metrics, analysis, {
    includeSecondaryFacets: input.includeSecondaryFacets ?? false,
  });

  if (ranked.length === 0) {
    await store.updateReviewSession(session.id, {
      selectedFacet: null,
      updatedAt: store.now(),
    });
    return {
      facet: null,
      questionText: null,
      voiceText: null,
      whyThisQuestion:
        "No eligible follow-up remained after the MVP allow-list, reliability, and coverage checks.",
      scoreBreakdown: null,
      supportingEvidence: [],
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
    createdAt,
  });

  await store.updateReviewSession(session.id, {
    draftReview: input.draftReview,
    selectedFacet: top.facet,
    updatedAt: createdAt,
  });

  return {
    facet: top.facet,
    questionText: question.questionText,
    voiceText: question.voiceText,
    whyThisQuestion,
    scoreBreakdown: top.scoreBreakdown,
    supportingEvidence,
    noFollowUp: false,
  };
}

export async function submitFollowUpAnswer(
  store: ReviewGapStore,
  aiClient: ReviewGapAIClient | undefined,
  input: SubmitFollowUpAnswerInput,
): Promise<SubmitFollowUpAnswerResult> {
  const session = await requireSession(store, input.sessionId);
  const property = await requireProperty(store, session.propertyId);
  const extraction = await extractAnswerFactsWithFallback(aiClient, {
    facet: input.facet,
    property,
    answerText: input.answerText,
  });
  const createdAt = store.now();

  await store.createFollowUpAnswer({
    sessionId: session.id,
    facet: input.facet,
    answerText: input.answerText,
    structuredFacts: extraction.structuredFacts,
    confidence: extraction.confidence,
    usedFallback: extraction.usedFallback,
    createdAt,
  });

  const evidenceUpdates: Array<Omit<PropertyEvidenceUpdate, "id">> =
    extraction.structuredFacts.map((fact) => ({
      propertyId: property.propertyId,
      facet: fact.facet,
      factType: fact.factType,
      value: fact.value,
      confidence: fact.confidence,
      sourceSessionId: session.id,
      createdAt,
      rawFact: fact,
    }));

  if (evidenceUpdates.length > 0) {
    await store.appendPropertyEvidenceUpdates(evidenceUpdates);
  }

  await store.updateReviewSession(session.id, {
    selectedFacet: input.facet,
    updatedAt: createdAt,
  });

  return {
    structuredFacts: extraction.structuredFacts,
    confidence: extraction.confidence,
    propertyCardDelta: {
      summary: propertyCardDeltaSummary(input.facet, extraction.structuredFacts),
      addedFacts: extraction.structuredFacts,
    },
    usedFallback: extraction.usedFallback,
  };
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

export type { RuntimeFacet };
