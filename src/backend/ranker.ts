import type { PropertyFacetMetric } from "./types.js";
import type { LearnedLinearRankerArtifact, LearnedRankerArtifact } from "./types.js";

export function isLearnedRankerCompatible(
  artifact: LearnedRankerArtifact | undefined,
): artifact is LearnedLinearRankerArtifact {
  return Boolean(
    artifact &&
      artifact.artifactType === "learned_ranker" &&
      artifact.modelKind === "linear" &&
      artifact.featureKeys.length === artifact.featureStats.length &&
      artifact.featureKeys.length === artifact.coefficients.length,
  );
}

export function scoreLearnedRanker(
  artifact: LearnedRankerArtifact | undefined,
  metric: PropertyFacetMetric,
): number | undefined {
  if (!isLearnedRankerCompatible(artifact)) {
    return undefined;
  }

  let total = artifact.intercept;
  for (let index = 0; index < artifact.featureKeys.length; index += 1) {
    const rawValue = learnedFeatureValue(metric, artifact.featureKeys[index]!);
    const stats = artifact.featureStats[index]!;
    const standardized =
      stats.std > 0 ? (rawValue - stats.mean) / stats.std : rawValue - stats.mean;
    total += standardized * artifact.coefficients[index]!;
  }
  return round(total);
}

export function learnedFeatureValue(
  metric: PropertyFacetMetric,
  featureKey: string,
): number {
  switch (featureKey) {
    case "importance":
      return metric.importance;
    case "daysSince":
      return Math.min(metric.daysSince >= 9999 ? 365 : metric.daysSince, 365);
    case "stalenessScore":
      return metric.stalenessScore;
    case "mentionRate":
      return metric.mentionRate;
    case "matchedReviewRate":
      return metric.matchedReviewRate;
    case "meanCosMatchedReviews":
      return metric.meanCosMatchedReviews;
    case "validatedConflictScore":
      return metric.validatedConflictScore;
    case "validatedConflictCount":
      return metric.validatedConflictCount;
    case "preCutoffReviewCount":
    case "reviewCount":
    case "sampleSize":
      return metric.sampleSize ?? metric.vendorSampleSize ?? metric.firstPartySampleSize ?? 0;
    case "reliability_high":
      return metric.reliabilityClass === "high" ? 1 : 0;
    case "reliability_medium":
      return metric.reliabilityClass === "medium" ? 1 : 0;
    case "reliability_low":
      return metric.reliabilityClass === "low" ? 1 : 0;
    case "reliability_blocked":
      return metric.reliabilityClass === "blocked" ? 1 : 0;
    default:
      return 0;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
