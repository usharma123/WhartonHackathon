import type {
  EligibleFacetSummary,
  PropertyFacetEvidence,
  PropertyFacetMetric,
  PropertyRecord,
} from "./types.js";
import type { ReviewGapStore } from "./store.js";

export interface RuntimeBundle {
  generatedAt: string;
  sourceArtifacts: string[];
  properties: PropertyRecord[];
  propertyFacetMetrics: PropertyFacetMetric[];
  propertyFacetEvidence: PropertyFacetEvidence[];
}

export async function seedRuntimeBundle(
  store: ReviewGapStore,
  bundle: RuntimeBundle,
): Promise<void> {
  for (const property of bundle.properties) {
    await store.upsertProperty(property);
  }

  for (const metric of bundle.propertyFacetMetrics) {
    await store.upsertPropertyFacetMetric(metric);
  }

  const evidenceByFacet = new Map<string, PropertyFacetEvidence[]>();
  for (const evidence of bundle.propertyFacetEvidence) {
    const key = `${evidence.propertyId}:${evidence.facet}`;
    const existing = evidenceByFacet.get(key) ?? [];
    existing.push(evidence);
    evidenceByFacet.set(key, existing);
  }

  for (const [key, evidence] of evidenceByFacet.entries()) {
    const [propertyId, facet] = key.split(":");
    await store.replacePropertyFacetEvidence(
      propertyId,
      facet as PropertyFacetMetric["facet"],
      evidence,
    );
  }
}

export function summarizeEligibleFacet(
  metric: PropertyFacetMetric,
): EligibleFacetSummary {
  return {
    facet: metric.facet,
    reliabilityClass: metric.reliabilityClass,
    importance: metric.importance,
  };
}
