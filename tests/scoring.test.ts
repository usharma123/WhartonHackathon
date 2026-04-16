import { describe, expect, it } from "vitest";

import { buildScoreBreakdown, rankFacetMetrics } from "../src/backend/scoring.js";
import type { LearnedRankerArtifact, PropertyFacetMetric } from "../src/backend/types.js";

const baseMetric: PropertyFacetMetric = {
  propertyId: "property_1",
  facet: "check_in",
  importance: 0.8,
  threshold: 0.4,
  reliabilityClass: "high",
  daysSince: 120,
  stalenessScore: 0.4,
  mentionRate: 0.2,
  matchedReviewRate: 0.2,
  meanCosMatchedReviews: 0.6,
  validatedConflictCount: 1,
  validatedConflictScore: 0.04,
  listingTextPresent: true,
  sampleSize: 12,
};

const learnedLinearArtifact: LearnedRankerArtifact = {
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
  coefficients: [0.5, 4, 0.01, 0.2],
  intercept: 0.1,
};

describe("learned scoring", () => {
  it("uses learned linear base scores while keeping session adjustments deterministic", () => {
    const breakdown = buildScoreBreakdown(
      baseMetric,
      { mentionedFacets: ["check_in"], likelyKnownFacets: [] },
      { learnedArtifact: learnedLinearArtifact, rankerSource: "learned_linear" },
    );

    expect(breakdown.rankerSource).toBe("learned_linear");
    expect(breakdown.baseModelVersion).toBe("test-linear");
    expect(breakdown.baseScore).toBeCloseTo(0.98, 3);
    expect(breakdown.sessionAdjustment).toBe(-0.35);
    expect(breakdown.finalScore).toBeCloseTo(0.63, 3);
    expect(breakdown.heuristicScore).not.toBe(breakdown.finalScore);
    expect(breakdown.total).toBe(breakdown.finalScore);
  });

  it("falls back to heuristic scoring when the learned artifact is not runtime-compatible", () => {
    const treeArtifact: LearnedRankerArtifact = {
      artifactType: "learned_ranker",
      version: "tree-exp",
      generatedAt: "2026-04-15T00:00:00Z",
      modelKind: "tree",
      featureKeys: ["importance"],
      treePayloadJson: "{}",
    };
    const [ranked] = rankFacetMetrics(
      [baseMetric],
      { mentionedFacets: [], likelyKnownFacets: ["check_in"] },
      { learnedArtifact: treeArtifact, rankerSource: "learned_tree" },
    );

    expect(ranked.scoreBreakdown.rankerSource).toBe("heuristic");
    expect(ranked.scoreBreakdown.baseModelVersion).toBeUndefined();
    expect(ranked.scoreBreakdown.finalScore).toBe(ranked.scoreBreakdown.heuristicScore);
    expect(ranked.scoreBreakdown.reviewerKnowsBoost).toBe(0.08);
  });
});
