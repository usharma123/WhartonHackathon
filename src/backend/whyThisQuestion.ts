import { facetLabel, type RuntimeFacet } from "./facets.js";
import type { PropertyFacetEvidence, ScoreBreakdown } from "./types.js";

export function buildWhyThisQuestion(
  facet: RuntimeFacet,
  breakdown: ScoreBreakdown,
  supportingEvidence: PropertyFacetEvidence[],
): string {
  const reasons: string[] = [];

  if (breakdown.conflict >= 0.08) {
    reasons.push("there is validated conflicting guest evidence");
  }
  if (breakdown.coverageGap >= 0.12) {
    reasons.push("recent reviewers rarely mention it");
  }
  if (breakdown.matchedSupportGap >= 0.1) {
    reasons.push("recent matched support for the listing is weak");
  }
  if (breakdown.staleness >= 0.12) {
    reasons.push("the freshest evidence is stale");
  }
  if (breakdown.reviewerKnowsBoost > 0) {
    reasons.push("the current review suggests the guest likely knows the answer");
  }

  const headline = `Asked about ${facetLabel(facet)} because ${joinReasons(
    reasons.slice(0, 3),
  )}.`;

  const evidenceLine = supportingEvidence[0]
    ? `Supporting evidence: ${supportingEvidence[0].snippet}`
    : "Supporting evidence: listing support is thin for this facet.";

  return `${headline} ${evidenceLine}`.trim();
}

function joinReasons(reasons: string[]): string {
  if (reasons.length === 0) {
    return "it scored highest under the deterministic ranking policy";
  }
  if (reasons.length === 1) {
    return reasons[0];
  }
  if (reasons.length === 2) {
    return `${reasons[0]} and ${reasons[1]}`;
  }
  return `${reasons[0]}, ${reasons[1]}, and ${reasons[2]}`;
}
