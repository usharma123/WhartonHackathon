import {
  canAutoSelectFacet,
  isBlockedAutoFacet,
  type RuntimeFacet,
} from "./facets.js";
import type {
  PropertyFacetLiveSignal,
  PropertyFacetMetric,
  ReviewAnalysisResult,
  ScoreBreakdown,
} from "./types.js";

const MAX_STALENESS_DAYS = 365;
const MAX_CONFLICT_SCORE = 0.08;
const MENTIONED_PENALTY = 0.35;
const REVIEWER_KNOWS_BOOST = 0.08;

export function normalizeStaleness(daysSince: number): number {
  if (daysSince >= 9999) {
    return 1;
  }
  return clamp(daysSince / MAX_STALENESS_DAYS);
}

export function normalizeConflict(validatedConflictScore: number): number {
  return clamp(validatedConflictScore / MAX_CONFLICT_SCORE);
}

export function matchedSupport(metric: PropertyFacetMetric): number {
  if (metric.matchedReviewRate <= 0 || metric.meanCosMatchedReviews <= 0) {
    return 0;
  }
  return clamp(metric.meanCosMatchedReviews);
}

export function applyLiveSignalToMetric(
  metric: PropertyFacetMetric,
  signal?: PropertyFacetLiveSignal,
): PropertyFacetMetric {
  if (!signal) {
    return metric;
  }
  return {
    ...metric,
    mentionRate: signal.mentionRate,
    daysSince: signal.daysSince,
    stalenessScore: round(normalizeStaleness(signal.daysSince)),
    validatedConflictScore: signal.conflictScore,
    validatedConflictCount:
      signal.conflictScore > 0 ? Math.max(metric.validatedConflictCount, 1) : 0,
    listingTextPresent: signal.listingTextPresent,
  };
}

export function buildScoreBreakdown(
  metric: PropertyFacetMetric,
  analysis: Pick<ReviewAnalysisResult, "mentionedFacets" | "likelyKnownFacets">,
): ScoreBreakdown {
  const alreadyMentionedPenalty = analysis.mentionedFacets.includes(metric.facet)
    ? -MENTIONED_PENALTY
    : 0;
  const reviewerKnowsBoost = analysis.likelyKnownFacets.includes(metric.facet)
    ? REVIEWER_KNOWS_BOOST
    : 0;

  const breakdown: ScoreBreakdown = {
    importance: round(metric.importance * 0.25),
    staleness: round(metric.stalenessScore * 0.25),
    conflict: round(normalizeConflict(metric.validatedConflictScore) * 0.2),
    coverageGap: round((1 - metric.mentionRate) * 0.15),
    matchedSupportGap: round((1 - matchedSupport(metric)) * 0.15),
    alreadyMentionedPenalty: round(alreadyMentionedPenalty),
    reviewerKnowsBoost: round(reviewerKnowsBoost),
    total: 0,
  };

  breakdown.total = round(
    breakdown.importance +
      breakdown.staleness +
      breakdown.conflict +
      breakdown.coverageGap +
      breakdown.matchedSupportGap +
      breakdown.alreadyMentionedPenalty +
      breakdown.reviewerKnowsBoost,
  );
  return breakdown;
}

export function isFacetEligible(
  metric: PropertyFacetMetric,
  {
    includeSecondaryFacets = false,
  }: {
    includeSecondaryFacets?: boolean;
  } = {},
): boolean {
  if (isBlockedAutoFacet(metric.facet)) {
    return false;
  }
  if (!canAutoSelectFacet(metric.facet, includeSecondaryFacets)) {
    return false;
  }
  if (!metric.listingTextPresent) {
    return false;
  }
  return metric.reliabilityClass === "high" || metric.reliabilityClass === "medium";
}

export function rankFacetMetrics(
  metrics: PropertyFacetMetric[],
  analysis: Pick<ReviewAnalysisResult, "mentionedFacets" | "likelyKnownFacets">,
  options: {
    includeSecondaryFacets?: boolean;
  } = {},
): Array<{ facet: RuntimeFacet; metric: PropertyFacetMetric; scoreBreakdown: ScoreBreakdown }> {
  return metrics
    .filter((metric) => isFacetEligible(metric, options))
    .map((metric) => ({
      facet: metric.facet,
      metric,
      scoreBreakdown: buildScoreBreakdown(metric, analysis),
    }))
    .sort((left, right) => right.scoreBreakdown.total - left.scoreBreakdown.total);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
