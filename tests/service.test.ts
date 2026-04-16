import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ReviewGapAIClient } from "../src/backend/ai.js";
import {
  analyzeDraftReview,
  confirmEnhancedReview,
  createReviewSession,
  finalizeReviewPreview,
  getSessionSummary,
  selectNextQuestion,
  submitFollowUpAnswer,
  updateStructuredReview,
} from "../src/backend/service.js";
import { loadRuntimeBundle } from "../src/backend/runtimeBundle.node.js";
import { seedRuntimeBundle } from "../src/backend/runtimeBundle.js";
import { InMemoryReviewGapStore } from "../src/backend/store.js";
import type {
  FinalizeReviewPreviewResult,
  LearnedRankerArtifact,
  PropertyRecord,
} from "../src/backend/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(
  root,
  "EDA",
  "data_artifacts",
  "runtime",
  "reviewgap_runtime_bundle.json",
);

const PARKING_PROPERTY =
  "7d027ef72c02eaa17af3c993fd5dba50d17b41a6280389a46c13c7e2c32a5b06";
const BREAKFAST_PROPERTY =
  "3216b1b7885bffdb336265a8de7322ba0cd477cfb3d4f99d19acf488f76a1941";
const CHECKIN_PROPERTY =
  "ff26cdda236b233f7c481f0e896814075ac6bed335e162e0ff01d5491343f838";

function selectedFactIds(preview: FinalizeReviewPreviewResult) {
  return preview.factCandidates.filter((fact) => fact.selectedByDefault).map((fact) => fact.id);
}

async function createSeededStore() {
  const store = new InMemoryReviewGapStore();
  const bundle = await loadRuntimeBundle(bundlePath);
  await seedRuntimeBundle(store, bundle);
  return { store, bundle };
}

const throwingAiClient: ReviewGapAIClient = {
  analyzeReview: async () => {
    throw new Error("AI unavailable");
  },
  generateQuestion: async () => {
    throw new Error("AI unavailable");
  },
  generateClarifier: async () => {
    throw new Error("AI unavailable");
  },
  extractAnswerFacts: async () => {
    throw new Error("AI unavailable");
  },
  generateEnhancedReview: async () => {
    throw new Error("AI unavailable");
  },
};

const firstPersonOnlyAiClient: ReviewGapAIClient = {
  analyzeReview: async () => {
    throw new Error("unused in this test");
  },
  generateQuestion: async () => {
    throw new Error("unused in this test");
  },
  generateClarifier: async () => {
    throw new Error("unused in this test");
  },
  extractAnswerFacts: async () => {
    throw new Error("unused in this test");
  },
  generateEnhancedReview: async () => ({
    reviewText: "I had a smooth check-in and the room was clean",
  }),
};

const underDetectingAiClient: ReviewGapAIClient = {
  analyzeReview: async () => ({
    mentionedFacets: [],
    likelyKnownFacets: [],
    sentiment: "neutral",
    reviewReady: true,
    readinessReason: null,
    suggestedClarifierPrompt: null,
    mlMentionProbByFacet: {},
    mlLikelyKnownByFacet: {},
    usedML: false,
    usedOpenAI: true,
  }),
  generateQuestion: async () => ({
    questionText: "How was breakfast in practice?",
    voiceText: "How was breakfast in practice?",
  }),
  generateClarifier: async () => ({
    assistantText: "Tell me one specific detail from the stay.",
  }),
  extractAnswerFacts: async () => ({
    structuredFacts: [],
    confidence: 0.5,
  }),
  generateEnhancedReview: async () => ({
    reviewText: "The stay was fine.",
  }),
};

const malformedQuestionAiClient: ReviewGapAIClient = {
  analyzeReview: async () => ({
    mentionedFacets: [],
    likelyKnownFacets: [],
    sentiment: "neutral",
    reviewReady: true,
    readinessReason: null,
    suggestedClarifierPrompt: null,
    mlMentionProbByFacet: {},
    mlLikelyKnownByFacet: {},
    usedML: false,
    usedOpenAI: true,
  }),
  generateQuestion: async () => ({ questionText: "" as string, voiceText: "" as string }),
  generateClarifier: async () => ({
    assistantText: "Tell me one specific detail from the stay.",
  }),
  extractAnswerFacts: async () => ({
    structuredFacts: [],
    confidence: 0.5,
  }),
  generateEnhancedReview: async () => ({
    reviewText: "The stay was fine.",
  }),
};

const learnedRankerArtifact: LearnedRankerArtifact = {
  artifactType: "learned_ranker",
  version: "test-linear",
  generatedAt: "2026-04-15T00:00:00Z",
  modelKind: "linear",
  featureKeys: ["importance", "validatedConflictScore", "sampleSize", "reliability_high"],
  featureStats: [
    { mean: 0, std: 1 },
    { mean: 0, std: 1 },
    { mean: 0, std: 1 },
    { mean: 0, std: 1 },
  ],
  coefficients: [0.5, 3.0, 0.01, 0.2],
  intercept: 0.1,
};

describe("session flow", () => {
  it("creates a review session with eligible facets", async () => {
    const { store } = await createSeededStore();
    const result = await createReviewSession(store, {
      propertyId: CHECKIN_PROPERTY,
    });

    expect(result.sessionId).toMatch(/^session_/);
    expect(result.eligibleFacets.length).toBeGreaterThan(0);
  });

  it("falls back deterministically when OpenAI fails", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: CHECKIN_PROPERTY });
    const analysis = await analyzeDraftReview(store, throwingAiClient, {
      sessionId: session.sessionId,
      draftReview: "Check-in was rough and we waited for a room key.",
    });

    expect(analysis.usedFallback).toBe(true);
    expect(analysis.mentionedFacets).toContain("check_in");
  });

  it("supports the analyze -> ask -> answer -> preview happy path", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    const draftReview = "The room was clean and the staff were nice.";
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview,
    });

    expect(question.noFollowUp).toBe(false);
    expect(question.facet).toBe("amenities_parking");

    const answer = await submitFollowUpAnswer(store, {
      sessionId: session.sessionId,
      facet: "amenities_parking",
      answerText: "Parking was tight and we paid $18, but we still found a spot.",
    });
    const preview = await finalizeReviewPreview(store, undefined, {
      sessionId: session.sessionId,
      draftReview,
    });
    const summary = await getSessionSummary(store, session.sessionId);

    expect(answer.answerRecorded).toBe(true);
    expect(preview.factCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factType: "available" }),
        expect.objectContaining({ factType: "parking_fee", value: 18 }),
      ]),
    );
    expect(summary.selectedFacet).toBeNull();
    expect(summary.accumulatedEvidenceUpdates.length).toBe(0);
  });

  it("logs heuristic vs learned shadow rankings with score provenance", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    const result = await selectNextQuestion(
      store,
      undefined,
      {
        sessionId: session.sessionId,
        draftReview: "The room was clean and the staff were nice.",
      },
      undefined,
      learnedRankerArtifact,
    );

    const shadowEvents = await store.listRankerShadowEvents(session.sessionId);

    expect(result.turnType).toBe("facet_followup");
    expect(result.scoreBreakdown?.rankerSource).toBe("learned_linear");
    expect(result.scoreBreakdown?.baseModelVersion).toBe("test-linear");
    expect(shadowEvents).toHaveLength(1);
    expect(shadowEvents[0]).toEqual(
      expect.objectContaining({
        sessionId: session.sessionId,
        rankerSource: "learned_linear",
        heuristicTop3: expect.any(Array),
        servedTop3: expect.any(Array),
      }),
    );
  });

  it("persists structured ratings on the session and includes them in preview metadata", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    await updateStructuredReview(store, {
      sessionId: session.sessionId,
      overallRating: 8,
      aspectRatings: { service: 4, cleanliness: 5 },
    });

    const preview = await finalizeReviewPreview(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "The room was clean and the staff were friendly throughout our stay.",
    });
    const updatedSession = await store.getReviewSession(session.sessionId);

    expect(updatedSession?.overallRating).toBe(8);
    expect(updatedSession?.aspectRatings).toEqual({ service: 4, cleanliness: 5 });
    expect(preview.overallRating).toBe(8);
    expect(preview.aspectRatings).toEqual({ service: 4, cleanliness: 5 });
  });

  it("appends the overall rating sentence when the AI review body omits it", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    await updateStructuredReview(store, {
      sessionId: session.sessionId,
      overallRating: 8,
    });

    const preview = await finalizeReviewPreview(store, firstPersonOnlyAiClient, {
      sessionId: session.sessionId,
      draftReview: "Check-in was easy and the room was clean.",
    });

    expect(preview.reviewText).toBe(
      "I had a smooth check-in and the room was clean. I'd rate this stay 8 out of 10.",
    );
  });

  it("keeps greetings in conversational clarification mode", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: CHECKIN_PROPERTY });

    const nextTurn = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "hi",
    });

    expect(nextTurn.turnType).toBe("clarify_review");
    expect(nextTurn.facet).toBeNull();
    expect(nextTurn.readinessReason).toBe("greeting_or_small_talk");
    expect(await store.getLatestFollowUpQuestion(session.sessionId)).toBeNull();
  });

  it("returns a conversational clarifier for vague reviews", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: CHECKIN_PROPERTY });

    const nextTurn = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "bad stay",
    });

    expect(nextTurn.turnType).toBe("clarify_review");
    expect(nextTurn.facet).toBeNull();
    expect(nextTurn.noFollowUp).toBe(false);
  });

  it("keeps check-in questions retrospective instead of policy-style", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: CHECKIN_PROPERTY });

    const nextTurn = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview:
        "The decor was nice, but service was lackluster and the room itself was only okay.",
    });

    if (nextTurn.turnType !== "facet_followup") {
      throw new Error("Expected a facet follow-up turn.");
    }

    expect(nextTurn.questionText.toLowerCase()).not.toContain("arrive early");
    expect(nextTurn.questionText.toLowerCase()).not.toContain("before booking");
  });

  it("still avoids already-mentioned facets when the AI under-detects review coverage", async () => {
    const store = new InMemoryReviewGapStore();
    const property: PropertyRecord = {
      propertyId: "ai_under_detect",
      propertySummary: "Synthetic property",
      facetListingTexts: {
        check_in: "check_in_start_time: 3:00 PM",
        amenities_breakfast: "breakfast included",
      },
      demoFlags: [],
    };
    await store.upsertProperty(property);
    await store.upsertPropertyFacetMetric({
      propertyId: "ai_under_detect",
      facet: "check_in",
      importance: 0.95,
      threshold: 0.45,
      reliabilityClass: "high",
      daysSince: 120,
      stalenessScore: 0.33,
      mentionRate: 0.01,
      matchedReviewRate: 0.04,
      meanCosMatchedReviews: 0.36,
      validatedConflictCount: 1,
      validatedConflictScore: 0.048,
      listingTextPresent: true,
    });
    await store.upsertPropertyFacetMetric({
      propertyId: "ai_under_detect",
      facet: "amenities_breakfast",
      importance: 0.9,
      threshold: 0.4,
      reliabilityClass: "high",
      daysSince: 130,
      stalenessScore: 0.36,
      mentionRate: 0.0,
      matchedReviewRate: 0.02,
      meanCosMatchedReviews: 0.31,
      validatedConflictCount: 1,
      validatedConflictScore: 0.03,
      listingTextPresent: true,
    });
    const session = await createReviewSession(store, { propertyId: "ai_under_detect" });

    const question = await selectNextQuestion(store, underDetectingAiClient, {
      sessionId: session.sessionId,
      draftReview: "Check-in was smooth and the front desk was friendly.",
    });

    expect(question.facet).toBe("amenities_breakfast");
  });

  it("falls back to the deterministic question when the AI returns malformed question text", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });

    const question = await selectNextQuestion(store, malformedQuestionAiClient, {
      sessionId: session.sessionId,
      draftReview:
        "The room was clean, the staff were friendly, and the stay felt easy overall.",
    });

    expect(question.turnType).toBe("facet_followup");
    expect(question.questionSource?.usedFallback).toBe(true);
    expect(question.questionText).toBe(
      "One quick thing: how was parking in practice, especially space, ease, or any fees?",
    );
  });

  it("stops asking after two clarification turns and moves to drafting", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: CHECKIN_PROPERTY });

    const first = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "hi",
    });
    const second = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "still not sure",
    });
    const third = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "okay",
    });

    expect(first.turnType).toBe("clarify_review");
    expect(second.turnType).toBe("clarify_review");
    expect(third.turnType).toBe("no_follow_up");
    expect(third.noFollowUp).toBe(true);
  });

  it("projects an authenticated review into the live corpus and first-party evidence", async () => {
    const { store } = await createSeededStore();
    const before = await store.getProperty(PARKING_PROPERTY);

    const session = await createReviewSession(store, {
      propertyId: PARKING_PROPERTY,
      draftReview: "Parking was cramped and the overnight fee felt excessive.",
      tokenIdentifier: "clerk:user_1",
    });
    await updateStructuredReview(store, {
      sessionId: session.sessionId,
      overallRating: 6,
    });
    const preview = await finalizeReviewPreview(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "Parking was cramped and the overnight fee felt excessive.",
    });
    await confirmEnhancedReview(store, {
      sessionId: session.sessionId,
      tokenIdentifier: "clerk:user_1",
      finalReviewText: preview.reviewText,
      factCandidates: preview.factCandidates,
      confirmedFactIds: selectedFactIds(preview),
    });

    const liveReviews = await store.listPropertyLiveReviews(PARKING_PROPERTY);
    const firstPartyReviews = liveReviews.filter((review) => review.sourceVendor === "first_party");
    const evidence = await store.listPropertyFacetEvidence(PARKING_PROPERTY, "amenities_parking");
    const after = await store.getProperty(PARKING_PROPERTY);

    expect(firstPartyReviews).toHaveLength(1);
    expect(firstPartyReviews[0]).toEqual(
      expect.objectContaining({
        tokenIdentifier: "clerk:user_1",
        sessionId: session.sessionId,
      }),
    );
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: "first_party_review" }),
      ]),
    );
    expect(after?.liveReviewCount).toBeGreaterThan(before?.liveReviewCount ?? 0);
  });

  it("upserts one first-party corpus review per user and property", async () => {
    const { store } = await createSeededStore();

    const firstSession = await createReviewSession(store, {
      propertyId: PARKING_PROPERTY,
      draftReview: "Parking was impossible the first time.",
      tokenIdentifier: "clerk:user_1",
    });
    await updateStructuredReview(store, {
      sessionId: firstSession.sessionId,
      overallRating: 5,
    });
    const firstPreview = await finalizeReviewPreview(store, undefined, {
      sessionId: firstSession.sessionId,
      draftReview: "Parking was impossible the first time.",
    });
    await confirmEnhancedReview(store, {
      sessionId: firstSession.sessionId,
      tokenIdentifier: "clerk:user_1",
      finalReviewText: firstPreview.reviewText,
      factCandidates: firstPreview.factCandidates,
      confirmedFactIds: selectedFactIds(firstPreview),
    });
    const secondSession = await createReviewSession(store, {
      propertyId: PARKING_PROPERTY,
      draftReview: "Parking was still tight but easier once we found the garage entrance.",
      tokenIdentifier: "clerk:user_1",
    });
    await updateStructuredReview(store, {
      sessionId: secondSession.sessionId,
      overallRating: 7,
    });
    const secondPreview = await finalizeReviewPreview(store, undefined, {
      sessionId: secondSession.sessionId,
      draftReview: "Parking was still tight but easier once we found the garage entrance.",
    });
    await confirmEnhancedReview(store, {
      sessionId: secondSession.sessionId,
      tokenIdentifier: "clerk:user_1",
      finalReviewText: secondPreview.reviewText,
      factCandidates: secondPreview.factCandidates,
      confirmedFactIds: selectedFactIds(secondPreview),
    });

    const liveReviews = await store.listPropertyLiveReviews(PARKING_PROPERTY);
    const firstPartyReviews = liveReviews.filter((review) => review.sourceVendor === "first_party");
    const savedReviews = await store.listUserPropertyReviews(PARKING_PROPERTY);

    expect(firstPartyReviews).toHaveLength(1);
    expect(firstPartyReviews[0]?.text).toContain("garage entrance");
    expect(savedReviews).toHaveLength(1);
    expect(savedReviews[0]?.submissionCount).toBe(2);
  });

  it("ignores 'I don't know' answers when extracting facts and drafting the preview", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    await submitFollowUpAnswer(store, {
      sessionId: session.sessionId,
      facet: "amenities_parking",
      answerText: "I don't know",
    });

    const preview = await finalizeReviewPreview(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "The room was clean and the staff were friendly throughout the stay.",
    });

    expect(preview.factCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factType: "review_detail",
          value: "The room was clean and the staff were friendly throughout the stay",
        }),
      ]),
    );
    expect(preview.factCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factType: "freeform_note", value: "I don't know" }),
      ]),
    );
    expect(preview.reviewText.toLowerCase()).not.toContain("i don't know");
  });

  it("keeps preview text grounded in user input and surfaces draft details as facts", async () => {
    const store = new InMemoryReviewGapStore();
    await store.upsertProperty({
      propertyId: "detail_grounding",
      propertySummary: "Art deco hotel with free shuttle service and a bar/lounge.",
      facetListingTexts: {},
      demoFlags: [],
    });
    const session = await createReviewSession(store, {
      propertyId: "detail_grounding",
      draftReview: "The decor was great, staff was great, and there was a great shuttle service.",
    });
    await updateStructuredReview(store, {
      sessionId: session.sessionId,
      overallRating: 9,
    });

    const preview = await finalizeReviewPreview(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "The decor was great, staff was great, and there was a great shuttle service.",
    });

    expect(preview.reviewText.toLowerCase()).not.toContain("art deco hotel");
    expect(preview.factCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factType: "review_detail", value: "The decor was great" }),
        expect.objectContaining({ factType: "review_detail", value: "staff was great" }),
        expect.objectContaining({
          factType: "review_detail",
          value: "and there was a great shuttle service",
        }),
      ]),
    );
  });

  it("recomputes a blended property rating when a first-party rating is saved", async () => {
    const store = new InMemoryReviewGapStore();
    await store.upsertProperty({
      propertyId: "rating_synth",
      propertySummary: "Synthetic rating property",
      guestRating: 8,
      facetListingTexts: {},
      demoFlags: [],
    });
    const session = await createReviewSession(store, {
      propertyId: "rating_synth",
      draftReview: "The stay was strong overall.",
      tokenIdentifier: "clerk:user_7",
    });
    await updateStructuredReview(store, {
      sessionId: session.sessionId,
      overallRating: 10,
      aspectRatings: { service: 5, cleanliness: 5, amenities: 4, value: 4 },
    });
    const preview = await finalizeReviewPreview(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "The stay was strong overall.",
    });

    await confirmEnhancedReview(
      store,
      {
        sessionId: session.sessionId,
        tokenIdentifier: "clerk:user_7",
        finalReviewText: preview.reviewText,
        factCandidates: preview.factCandidates,
        confirmedFactIds: selectedFactIds(preview),
      },
      { guestRating: 8, reviewCount: 4 },
    );

    const property = await store.getProperty("rating_synth");
    const reviews = await store.listUserPropertyReviews("rating_synth");

    expect(property?.guestRating).toBe(8.4);
    expect(reviews[0]?.overallRating).toBe(10);
  });

  it("chooses another facet when the draft already covers check-in", async () => {
    const store = new InMemoryReviewGapStore();
    const property: PropertyRecord = {
      propertyId: "synthetic",
      propertySummary: "Synthetic property",
      facetListingTexts: {
        check_in: "check_in_start_time: 3:00 PM",
        amenities_breakfast: "breakfast included",
      },
      demoFlags: [],
    };
    await store.upsertProperty(property);
    await store.upsertPropertyFacetMetric({
      propertyId: "synthetic",
      facet: "check_in",
      importance: 0.95,
      threshold: 0.45,
      reliabilityClass: "high",
      daysSince: 120,
      stalenessScore: 0.33,
      mentionRate: 0.01,
      matchedReviewRate: 0.04,
      meanCosMatchedReviews: 0.36,
      validatedConflictCount: 1,
      validatedConflictScore: 0.048,
      listingTextPresent: true,
    });
    await store.upsertPropertyFacetMetric({
      propertyId: "synthetic",
      facet: "amenities_breakfast",
      importance: 0.9,
      threshold: 0.4,
      reliabilityClass: "high",
      daysSince: 130,
      stalenessScore: 0.36,
      mentionRate: 0.0,
      matchedReviewRate: 0.02,
      meanCosMatchedReviews: 0.31,
      validatedConflictCount: 1,
      validatedConflictScore: 0.03,
      listingTextPresent: true,
    });
    const session = await createReviewSession(store, { propertyId: "synthetic" });

    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "Check-in was smooth and the front desk was friendly.",
    });

    expect(question.facet).toBe("amenities_breakfast");
  });

  it("returns a no-follow-up response when no reliable facets are available", async () => {
    const store = new InMemoryReviewGapStore();
    await store.upsertProperty({
      propertyId: "empty",
      propertySummary: "No reliable facets",
      facetListingTexts: {},
      demoFlags: [],
    });
    await store.upsertPropertyFacetMetric({
      propertyId: "empty",
      facet: "pet",
      importance: 0.3,
      threshold: 0.45,
      reliabilityClass: "blocked",
      daysSince: 9999,
      stalenessScore: 1,
      mentionRate: 0,
      matchedReviewRate: 0,
      meanCosMatchedReviews: 0,
      validatedConflictCount: 0,
      validatedConflictScore: 0,
      listingTextPresent: true,
    });
    const session = await createReviewSession(store, { propertyId: "empty" });

    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview:
        "The room was clean, check-in was smooth, and the staff were friendly throughout the stay.",
    });

    expect(question.turnType).toBe("no_follow_up");
    expect(question.noFollowUp).toBe(true);
    expect(question.facet).toBeNull();
  });

  it("returns parking for the curated parking conflict property", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview:
        "The bed was comfortable, the room stayed quiet at night, and the staff were friendly throughout.",
    });

    expect(question.turnType).toBe("facet_followup");
    expect(question.facet).toBe("amenities_parking");
  });

  it("returns breakfast for the curated breakfast mismatch property", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: BREAKFAST_PROPERTY });
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview:
        "The room was clean, the bed was comfortable, and the hotel stayed quiet overnight.",
    });

    expect(question.turnType).toBe("facet_followup");
    expect(question.facet).toBe("amenities_breakfast");
  });

  it("returns check-in or check-out for a check-in complaint review", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: CHECKIN_PROPERTY });
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "Check-in was a disaster and we waited 40 minutes at the front desk.",
    });

    expect(["check_in", "check_out"]).toContain(question.facet);
  });

  it("never auto-selects pet in the MVP", async () => {
    const { store, bundle } = await createSeededStore();
    const propertyWithPet = bundle.properties.find((property) =>
      Object.keys(property.facetListingTexts).includes("pet"),
    );
    expect(propertyWithPet).toBeDefined();
    const session = await createReviewSession(store, {
      propertyId: propertyWithPet!.propertyId,
    });
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview:
        "The room was clean, the staff were helpful, and the stay felt easy overall.",
    });

    expect(question.facet).not.toBe("pet");
  });

  it("keeps listing text stable while only persisting evidence after confirmation", async () => {
    const { store } = await createSeededStore();
    const before = await store.getProperty(PARKING_PROPERTY);
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    const draftReview =
      "The staff were friendly, the room was quiet, and the bed was comfortable during our stay.";
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview,
    });

    expect(question.turnType).toBe("facet_followup");
    await submitFollowUpAnswer(store, {
      sessionId: session.sessionId,
      facet: question.facet!,
      answerText: "Parking was difficult and cost $12.",
    });
    await updateStructuredReview(store, {
      sessionId: session.sessionId,
      overallRating: 7,
    });
    const preview = await finalizeReviewPreview(store, undefined, {
      sessionId: session.sessionId,
      draftReview,
    });
    const afterPreview = await store.getProperty(PARKING_PROPERTY);
    const summary = await getSessionSummary(store, session.sessionId);

    expect(afterPreview?.facetListingTexts).toEqual(before?.facetListingTexts);
    expect(summary.extractedFacts.length).toBeGreaterThan(0);
    expect(summary.accumulatedEvidenceUpdates.length).toBe(0);

    await confirmEnhancedReview(store, {
      sessionId: session.sessionId,
      tokenIdentifier: "clerk:user_2",
      finalReviewText: preview.reviewText,
      factCandidates: preview.factCandidates,
      confirmedFactIds: selectedFactIds(preview),
    });
    const afterConfirm = await store.getProperty(PARKING_PROPERTY);
    const confirmedSummary = await getSessionSummary(store, session.sessionId);

    expect(afterConfirm?.facetListingTexts).toEqual(before?.facetListingTexts);
    expect(confirmedSummary.accumulatedEvidenceUpdates.length).toBeGreaterThan(0);
  });

  it("lets live facet signals change the next selected question without rewriting base metrics", async () => {
    const store = new InMemoryReviewGapStore();
    await store.upsertProperty({
      propertyId: "live_override",
      propertySummary: "Synthetic live override property",
      facetListingTexts: {
        check_in: "Check-in starts at 4pm",
        amenities_breakfast: "Breakfast buffet is available daily",
      },
      demoFlags: [],
    });
    await store.upsertPropertyFacetMetric({
      propertyId: "live_override",
      facet: "check_in",
      importance: 0.95,
      threshold: 0.45,
      reliabilityClass: "high",
      daysSince: 340,
      stalenessScore: 0.93,
      mentionRate: 0.01,
      matchedReviewRate: 0.04,
      meanCosMatchedReviews: 0.31,
      validatedConflictCount: 1,
      validatedConflictScore: 0.05,
      listingTextPresent: true,
    });
    await store.upsertPropertyFacetMetric({
      propertyId: "live_override",
      facet: "amenities_breakfast",
      importance: 0.9,
      threshold: 0.4,
      reliabilityClass: "high",
      daysSince: 210,
      stalenessScore: 0.58,
      mentionRate: 0.03,
      matchedReviewRate: 0.04,
      meanCosMatchedReviews: 0.34,
      validatedConflictCount: 1,
      validatedConflictScore: 0.02,
      listingTextPresent: true,
    });

    const beforeSession = await createReviewSession(store, { propertyId: "live_override" });
    const beforeQuestion = await selectNextQuestion(store, undefined, {
      sessionId: beforeSession.sessionId,
      draftReview:
        "The room stayed quiet at night, the staff were friendly, and the bed was comfortable.",
    });
    expect(beforeQuestion.facet).toBe("check_in");

    await store.replacePropertyFacetLiveSignals("live_override", [
      {
        propertyId: "live_override",
        facet: "check_in",
        mentionRate: 0.5,
        conflictScore: 0,
        latestReviewDate: "2026-04-10",
        daysSince: 4,
        listingTextPresent: true,
        reviewCountSampled: 8,
        supportSnippetCount: 4,
        vendorReviewCountSampled: 8,
        vendorSupportSnippetCount: 4,
        firstPartyReviewCountSampled: 0,
        firstPartySupportSnippetCount: 0,
        sampleConfidence: 0.8,
        weightedSupportRate: 0.5,
        evidenceMix: "vendor",
        topDriver: "Strong vendor evidence supports the current listing.",
        fetchedAt: "2026-04-14T00:00:00.000Z",
      },
      {
        propertyId: "live_override",
        facet: "amenities_breakfast",
        mentionRate: 0.02,
        conflictScore: 0.25,
        latestReviewDate: "2026-04-12",
        daysSince: 2,
        listingTextPresent: true,
        reviewCountSampled: 8,
        supportSnippetCount: 1,
        vendorReviewCountSampled: 8,
        vendorSupportSnippetCount: 1,
        firstPartyReviewCountSampled: 0,
        firstPartySupportSnippetCount: 0,
        sampleConfidence: 0.8,
        weightedSupportRate: 0.125,
        evidenceMix: "vendor",
        topDriver: "Recent vendor review conflicts suggest the listing may be stale.",
        fetchedAt: "2026-04-14T00:00:00.000Z",
      },
    ]);

    const afterSession = await createReviewSession(store, { propertyId: "live_override" });
    const afterQuestion = await selectNextQuestion(store, undefined, {
      sessionId: afterSession.sessionId,
      draftReview:
        "The room stayed quiet at night, the staff were friendly, and the bed was comfortable.",
    });

    expect(afterQuestion.facet).toBe("amenities_breakfast");
    expect((await store.listPropertyFacetLiveSignals("live_override")).length).toBe(2);
  });
});
