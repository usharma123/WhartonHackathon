import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadFacetClassifierArtifact, predictFacetMentions, type FacetClassifierArtifact } from "../src/backend/ml.js";
import { createReviewSession, selectNextQuestion } from "../src/backend/service.js";
import { InMemoryReviewGapStore } from "../src/backend/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(
  root,
  "EDA",
  "data_artifacts",
  "runtime",
  "review_classifier_artifact.json",
);
const reportPath = path.join(
  root,
  "EDA",
  "data_artifacts",
  "runtime",
  "review_classifier_report.json",
);
const fixturesPath = path.join(
  root,
  "EDA",
  "data_artifacts",
  "runtime",
  "review_classifier_fixtures.json",
);

describe("review classifier artifacts", () => {
  it("loads the exported classifier artifact", async () => {
    const artifact = await loadFacetClassifierArtifact(artifactPath);
    expect(artifact.artifactType).toBe("facet_classifier");
    expect(artifact.models).toHaveLength(6);
    expect(artifact.terms.length).toBe(artifact.idf.length);
  });

  it("matches frozen python probabilities within a tight tolerance", async () => {
    const artifact = await loadFacetClassifierArtifact(artifactPath);
    const fixtures = JSON.parse(await readFile(fixturesPath, "utf8")) as Array<{
      text: string;
      probabilities: Record<string, number>;
    }>;
    for (const fixture of fixtures) {
      const prediction = predictFacetMentions(artifact, fixture.text);
      for (const [facet, expected] of Object.entries(fixture.probabilities)) {
        const actual = prediction.mentionProbabilities[facet as keyof typeof prediction.mentionProbabilities];
        expect(actual).toBeDefined();
        expect(Math.abs((actual ?? 0) - expected)).toBeLessThan(0.025);
      }
    }
  });

  it("ships only when the training report passes its gates", async () => {
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      shippingGatePassed: boolean;
      facets: Array<{ rocAuc: number; f1: number }>;
    };
    expect(report.shippingGatePassed).toBe(true);
    expect(report.facets.every((facet) => facet.rocAuc > 0.7 && facet.f1 > 0.4)).toBe(true);
  });

  it("uses ML-assisted mention signals to avoid repeating check-in", async () => {
    const store = new InMemoryReviewGapStore();
    await store.upsertProperty({
      propertyId: "ml-synthetic",
      propertySummary: "Synthetic property",
      facetListingTexts: {
        check_in: "check in at 3 PM",
        amenities_breakfast: "breakfast available",
      },
      demoFlags: [],
    });
    await store.upsertPropertyFacetMetric({
      propertyId: "ml-synthetic",
      facet: "check_in",
      importance: 0.95,
      threshold: 0.45,
      reliabilityClass: "high",
      daysSince: 180,
      stalenessScore: 0.49,
      mentionRate: 0.02,
      matchedReviewRate: 0.04,
      meanCosMatchedReviews: 0.35,
      validatedConflictCount: 1,
      validatedConflictScore: 0.04,
      listingTextPresent: true,
    });
    await store.upsertPropertyFacetMetric({
      propertyId: "ml-synthetic",
      facet: "amenities_breakfast",
      importance: 0.9,
      threshold: 0.4,
      reliabilityClass: "high",
      daysSince: 150,
      stalenessScore: 0.41,
      mentionRate: 0.01,
      matchedReviewRate: 0.03,
      meanCosMatchedReviews: 0.31,
      validatedConflictCount: 1,
      validatedConflictScore: 0.03,
      listingTextPresent: true,
    });
    const session = await createReviewSession(store, { propertyId: "ml-synthetic" });
    const fakeArtifact: FacetClassifierArtifact = {
      artifactType: "facet_classifier",
      version: "test",
      generatedAt: "2026-04-14",
      tokenizer: {
        regex: "\\b\\w\\w+\\b",
        minTokenLength: 2,
        ngramRange: [1, 2],
        lowercase: true,
        stripAccents: true,
        l2Normalize: true,
      },
      runtimeFacets: [
        "check_in",
        "check_out",
        "amenities_breakfast",
        "amenities_parking",
        "know_before_you_go",
        "amenities_pool",
      ],
      vocabulary: { arrival: 0, desk: 1, breakfast: 2 },
      terms: ["arrival", "desk", "breakfast"],
      idf: [1, 1, 1],
      models: [
        {
          facet: "check_in",
          intercept: 1,
          threshold: 0.6,
          coefficients: [2, 2, -1],
          topPositiveTerms: ["arrival", "desk"],
          topNegativeTerms: ["breakfast"],
          metrics: {
            trainingRows: 10,
            validationRows: 4,
            positiveRate: 0.5,
            rocAuc: 0.9,
            f1: 0.8,
            precision: 0.8,
            recall: 0.8,
          },
        },
        {
          facet: "check_out",
          intercept: -2,
          threshold: 0.5,
          coefficients: [0, 0, 0],
          topPositiveTerms: [],
          topNegativeTerms: [],
          metrics: {
            trainingRows: 10,
            validationRows: 4,
            positiveRate: 0.1,
            rocAuc: 0.8,
            f1: 0.5,
            precision: 0.5,
            recall: 0.5,
          },
        },
        {
          facet: "amenities_breakfast",
          intercept: -1,
          threshold: 0.5,
          coefficients: [0, 0, 1],
          topPositiveTerms: ["breakfast"],
          topNegativeTerms: ["arrival"],
          metrics: {
            trainingRows: 10,
            validationRows: 4,
            positiveRate: 0.3,
            rocAuc: 0.8,
            f1: 0.5,
            precision: 0.5,
            recall: 0.5,
          },
        },
        {
          facet: "amenities_parking",
          intercept: -2,
          threshold: 0.5,
          coefficients: [0, 0, 0],
          topPositiveTerms: [],
          topNegativeTerms: [],
          metrics: {
            trainingRows: 10,
            validationRows: 4,
            positiveRate: 0.1,
            rocAuc: 0.8,
            f1: 0.5,
            precision: 0.5,
            recall: 0.5,
          },
        },
        {
          facet: "know_before_you_go",
          intercept: -2,
          threshold: 0.5,
          coefficients: [0, 0, 0],
          topPositiveTerms: [],
          topNegativeTerms: [],
          metrics: {
            trainingRows: 10,
            validationRows: 4,
            positiveRate: 0.1,
            rocAuc: 0.8,
            f1: 0.5,
            precision: 0.5,
            recall: 0.5,
          },
        },
        {
          facet: "amenities_pool",
          intercept: -2,
          threshold: 0.5,
          coefficients: [0, 0, 0],
          topPositiveTerms: [],
          topNegativeTerms: [],
          metrics: {
            trainingRows: 10,
            validationRows: 4,
            positiveRate: 0.1,
            rocAuc: 0.8,
            f1: 0.5,
            precision: 0.5,
            recall: 0.5,
          },
        },
      ],
    };

    const result = await selectNextQuestion(
      store,
      undefined,
      {
        sessionId: session.sessionId,
        draftReview: "Arrival at the desk took forever before they settled us into the room.",
      },
      fakeArtifact,
    );

    expect(result.analysis?.usedML).toBe(true);
    expect(result.analysis?.mentionedFacets).toContain("check_in");
    expect(result.facet).toBe("amenities_breakfast");
  });
});
