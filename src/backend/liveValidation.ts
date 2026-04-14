import type { ReviewGapStore } from "./store.js";
import type { FacetClassifierArtifact } from "./ml.js";
import type {
  ImportedExpediaPropertySnapshot,
  PropertyRecord,
  PropertyFacetLiveSignal,
  PropertyFacetMetric,
  PropertyValidationState,
} from "./types.js";
import {
  buildExpediaFacetEvidence,
  buildLiveReviewSamples,
  deriveLiveFacetSignals,
} from "./propertySource.js";
import { ALL_RUNTIME_FACETS, FACET_POLICIES } from "./facets.js";
import { normalizeStaleness } from "./scoring.js";

export async function importExpediaPropertySnapshot(
  store: ReviewGapStore,
  snapshot: ImportedExpediaPropertySnapshot,
  classifierArtifact?: FacetClassifierArtifact,
): Promise<{
  property: PropertyRecord;
  validationState: PropertyValidationState;
  sampledReviewCount: number;
}> {
  const property = await applyImportedSnapshot(store, snapshot, classifierArtifact, {
    createIfMissing: true,
  });
  const validationState = await store.getPropertyValidationState(snapshot.propertyId);
  if (!validationState) {
    throw new Error(`Missing validation state for ${snapshot.propertyId}`);
  }
  return {
    property,
    validationState,
    sampledReviewCount: snapshot.reviews.length,
  };
}

async function applyImportedSnapshot(
  store: ReviewGapStore,
  snapshot: ImportedExpediaPropertySnapshot,
  classifierArtifact: FacetClassifierArtifact | undefined,
  options: { createIfMissing: boolean },
): Promise<PropertyRecord> {
  const existing = await store.getProperty(snapshot.propertyId);
  if (!existing && options.createIfMissing) {
    await store.upsertProperty({
      propertyId: snapshot.propertyId,
      propertySummary: snapshot.propertySummary,
      city: snapshot.city,
      province: snapshot.province,
      country: snapshot.country,
      guestRating: snapshot.guestRating,
      popularAmenities: snapshot.popularAmenities,
      facetListingTexts: snapshot.facetListingTexts,
      demoFlags: snapshot.demoFlags,
      demoScenario: snapshot.demoScenario,
      sourceVendor: snapshot.sourceVendor,
      sourceUrl: snapshot.sourceUrl,
      lastValidatedAt: snapshot.importedAt,
      validationStatus: "success",
      liveReviewCount: snapshot.reviews.length,
    });
  }

  const property = await store.getProperty(snapshot.propertyId);
  if (!property) {
    throw new Error(`Unknown property ${snapshot.propertyId}`);
  }

  const liveSignals =
    snapshot.reviews.length > 0
      ? deriveLiveFacetSignals(
          snapshot.propertyId,
          {
            sourceVendor: snapshot.sourceVendor,
            sourceUrl: snapshot.sourceUrl,
            propertySummary: snapshot.propertySummary,
            popularAmenities: snapshot.popularAmenities,
            city: snapshot.city,
            province: snapshot.province,
            country: snapshot.country,
            guestRating: snapshot.guestRating,
            facetListingTexts: snapshot.facetListingTexts,
            reviews: snapshot.reviews,
          },
          classifierArtifact,
          snapshot.importedAt,
        )
      : buildListingOnlyLiveSignals(snapshot);

  const liveReviews = buildLiveReviewSamples(
    snapshot.propertyId,
    snapshot.sourceUrl,
    snapshot.reviews,
    snapshot.importedAt,
  );
  const facetEvidence = buildExpediaFacetEvidence(
    snapshot.propertyId,
    {
      sourceVendor: snapshot.sourceVendor,
      sourceUrl: snapshot.sourceUrl,
      propertySummary: snapshot.propertySummary,
      popularAmenities: snapshot.popularAmenities,
      city: snapshot.city,
      province: snapshot.province,
      country: snapshot.country,
      guestRating: snapshot.guestRating,
      facetListingTexts: snapshot.facetListingTexts,
      reviews: snapshot.reviews,
    },
    classifierArtifact,
  );

  const baseMetrics = await store.listPropertyFacetMetrics(snapshot.propertyId);
  if (baseMetrics.length === 0) {
    for (const metric of buildBootstrapMetrics(snapshot.propertyId, liveSignals, classifierArtifact)) {
      await store.upsertPropertyFacetMetric(metric);
    }
  }

  const updatedProperty = existing
    ? await store.patchProperty(snapshot.propertyId, {
        propertySummary: snapshot.propertySummary,
        popularAmenities: snapshot.popularAmenities,
        city: snapshot.city,
        province: snapshot.province,
        country: snapshot.country,
        guestRating: snapshot.guestRating,
        facetListingTexts: snapshot.facetListingTexts,
        demoFlags: snapshot.demoFlags,
        demoScenario: snapshot.demoScenario,
        sourceVendor: snapshot.sourceVendor,
        sourceUrl: snapshot.sourceUrl,
        lastValidatedAt: snapshot.importedAt,
        validationStatus: "success",
        liveReviewCount: snapshot.reviews.length,
      })
    : (await store.getProperty(snapshot.propertyId))!;

  await store.replacePropertyLiveReviews(snapshot.propertyId, liveReviews);
  await store.replacePropertyFacetLiveSignals(snapshot.propertyId, liveSignals);

  for (const facet of ALL_RUNTIME_FACETS) {
    await store.replacePropertyFacetVendorEvidence(
      snapshot.propertyId,
      facet,
      "expedia",
      facetEvidence[facet],
    );
  }

  return updatedProperty;
}

function buildListingOnlyLiveSignals(
  snapshot: ImportedExpediaPropertySnapshot,
): PropertyFacetLiveSignal[] {
  return ALL_RUNTIME_FACETS.map((facet) => ({
    propertyId: snapshot.propertyId,
    facet,
    mentionRate: 0,
    conflictScore: 0,
    latestReviewDate: undefined,
    daysSince: 9999,
    listingTextPresent: Boolean(snapshot.facetListingTexts[facet]),
    reviewCountSampled: 0,
    supportSnippetCount: 0,
    fetchedAt: snapshot.importedAt,
  }));
}

function buildBootstrapMetrics(
  propertyId: string,
  liveSignals: ReturnType<typeof buildListingOnlyLiveSignals>,
  classifierArtifact?: FacetClassifierArtifact,
): PropertyFacetMetric[] {
  return liveSignals.map((signal) => {
    const threshold =
      classifierArtifact?.models.find((model) => model.facet === signal.facet)?.threshold ?? 0.45;
    const reliabilityClass = signal.listingTextPresent
      ? signal.supportSnippetCount >= 2
        ? "high"
        : "medium"
      : signal.supportSnippetCount >= 2
        ? "medium"
        : "low";
    return {
      propertyId,
      facet: signal.facet,
      importance: FACET_POLICIES[signal.facet].importance,
      threshold,
      reliabilityClass,
      daysSince: signal.daysSince,
      stalenessScore: normalizeStaleness(signal.daysSince),
      mentionRate: signal.mentionRate,
      matchedReviewRate:
        signal.reviewCountSampled > 0
          ? roundMetric(signal.supportSnippetCount / signal.reviewCountSampled)
          : 0,
      meanCosMatchedReviews:
        signal.supportSnippetCount > 0 ? Math.max(0.3, signal.mentionRate) : 0,
      validatedConflictCount:
        signal.conflictScore > 0
          ? Math.max(1, Math.round(signal.conflictScore * Math.max(1, signal.reviewCountSampled)))
          : 0,
      validatedConflictScore: signal.conflictScore,
      listingTextPresent: signal.listingTextPresent,
    };
  });
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
