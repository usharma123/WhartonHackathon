import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ReviewGapAIClient } from "../src/backend/ai.js";
import {
  analyzeDraftReview,
  createReviewSession,
  getSessionSummary,
  selectNextQuestion,
  submitFollowUpAnswer,
} from "../src/backend/service.js";
import { loadRuntimeBundle } from "../src/backend/runtimeBundle.node.js";
import { seedRuntimeBundle } from "../src/backend/runtimeBundle.js";
import { InMemoryReviewGapStore } from "../src/backend/store.js";
import type { PropertyRecord } from "../src/backend/types.js";

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
  extractAnswerFacts: async () => {
    throw new Error("AI unavailable");
  },
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

  it("supports the analyze -> rank -> ask -> answer -> summary happy path", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "The room was clean and the staff were nice.",
    });

    expect(question.noFollowUp).toBe(false);
    expect(question.facet).toBe("amenities_parking");

    const answer = await submitFollowUpAnswer(store, undefined, {
      sessionId: session.sessionId,
      facet: "amenities_parking",
      answerText: "Parking was tight and we paid $18, but we still found a spot.",
    });
    const summary = await getSessionSummary(store, session.sessionId);

    expect(answer.usedFallback).toBe(true);
    expect(answer.structuredFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factType: "available" }),
        expect.objectContaining({ factType: "parking_fee", value: 18 }),
      ]),
    );
    expect(summary.selectedFacet).toBe("amenities_parking");
    expect(summary.accumulatedEvidenceUpdates.length).toBeGreaterThan(0);
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
      draftReview: "Nice stay overall.",
    });

    expect(question.noFollowUp).toBe(true);
    expect(question.facet).toBeNull();
  });

  it("returns parking for the curated parking conflict property", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "Good location and comfortable bed.",
    });

    expect(question.facet).toBe("amenities_parking");
  });

  it("returns breakfast for the curated breakfast mismatch property", async () => {
    const { store } = await createSeededStore();
    const session = await createReviewSession(store, { propertyId: BREAKFAST_PROPERTY });
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "Room was clean and quiet.",
    });

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
      draftReview: "Nice stay.",
    });

    expect(question.facet).not.toBe("pet");
  });

  it("stores extracted facts in the summary without mutating property listing data", async () => {
    const { store } = await createSeededStore();
    const before = await store.getProperty(PARKING_PROPERTY);
    const session = await createReviewSession(store, { propertyId: PARKING_PROPERTY });
    const question = await selectNextQuestion(store, undefined, {
      sessionId: session.sessionId,
      draftReview: "Friendly staff.",
    });

    await submitFollowUpAnswer(store, undefined, {
      sessionId: session.sessionId,
      facet: question.facet!,
      answerText: "Parking was difficult and cost $12.",
    });
    const after = await store.getProperty(PARKING_PROPERTY);
    const summary = await getSessionSummary(store, session.sessionId);

    expect(after?.facetListingTexts).toEqual(before?.facetListingTexts);
    expect(summary.extractedFacts.length).toBeGreaterThan(0);
    expect(summary.accumulatedEvidenceUpdates.length).toBeGreaterThan(0);
  });
});
