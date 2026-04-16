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
  combineSourceAwareLiveSignals,
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
      vendorReviewCount: snapshot.reviews.length,
      firstPartyReviewCount: 0,
      liveReviewCount: snapshot.reviews.length,
      lastRecomputedAt: undefined,
      recomputeStatus: "recomputing",
      recomputeSourceVersion: 0,
    });
  }

  const property = await store.getProperty(snapshot.propertyId);
  if (!property) {
    throw new Error(`Unknown property ${snapshot.propertyId}`);
  }

  const vendorSignals =
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
    for (const metric of buildBootstrapMetrics(snapshot.propertyId, vendorSignals, classifierArtifact)) {
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
        recomputeStatus: "recomputing",
      })
    : (await store.getProperty(snapshot.propertyId))!;

  await store.replacePropertyLiveReviewsForVendor(
    snapshot.propertyId,
    "expedia",
    liveReviews,
  );

  for (const facet of ALL_RUNTIME_FACETS) {
    await store.replacePropertyFacetVendorEvidence(
      snapshot.propertyId,
      facet,
      "expedia",
      facetEvidence[facet],
    );
  }

  const combinedLiveReviews = await store.listPropertyLiveReviews(snapshot.propertyId);
  const firstPartyReviews = combinedLiveReviews.filter(
    (review) => review.sourceVendor === "first_party",
  );
  const liveSignals = combineSourceAwareLiveSignals({
    propertyId: snapshot.propertyId,
    facetListingTexts: snapshot.facetListingTexts,
    vendorReviews: combinedLiveReviews
      .filter((review) => review.sourceVendor === "expedia")
      .map((review) => ({
        headline: review.headline,
        text: review.text,
        reviewDate: review.reviewDate,
      })),
    firstPartyReviews: firstPartyReviews.map((review) => ({
      headline: review.headline,
      text: review.text,
      reviewDate: review.reviewDate,
    })),
    classifierArtifact,
    fetchedAt: snapshot.importedAt,
  });
  await store.replacePropertyFacetLiveSignals(snapshot.propertyId, liveSignals);

  const firstPartySavedReviews = await store.listUserPropertyReviews(snapshot.propertyId);
  const blendedGuestRating = computeBlendedGuestRating(
    snapshot.guestRating,
    snapshot.reviews.length,
    firstPartySavedReviews,
  );
  const priorVersion = updatedProperty.recomputeSourceVersion ?? 0;
  await store.patchProperty(snapshot.propertyId, {
    guestRating: blendedGuestRating,
    vendorReviewCount: snapshot.reviews.length,
    firstPartyReviewCount: firstPartySavedReviews.length,
    liveReviewCount: combinedLiveReviews.length,
    lastRecomputedAt: snapshot.importedAt,
    recomputeStatus: "ready",
    recomputeSourceVersion: priorVersion + 1,
  });

  return (await store.getProperty(snapshot.propertyId)) ?? updatedProperty;
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
      vendorReviewCountSampled: 0,
      vendorSupportSnippetCount: 0,
      firstPartyReviewCountSampled: 0,
      firstPartySupportSnippetCount: 0,
      sampleConfidence: 0,
      weightedSupportRate: 0,
      evidenceMix: "none",
      topDriver: "no_live_evidence",
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
      sampleSize: signal.reviewCountSampled,
      vendorSampleSize: signal.vendorReviewCountSampled,
      firstPartySampleSize: signal.firstPartyReviewCountSampled,
      sampleConfidence: signal.sampleConfidence,
      evidenceMix: signal.evidenceMix,
      topDriver: signal.topDriver,
    };
  });
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function computeBlendedGuestRating(
  sourceGuestRating: number | undefined,
  sourceReviewCount: number,
  reviews: Array<{ overallRating?: number }>,
): number | undefined {
  const firstPartyRatings = reviews
    .map((review) => review.overallRating)
    .filter((rating): rating is number => typeof rating === "number" && Number.isFinite(rating));
  const firstPartyCount = firstPartyRatings.length;
  const firstPartyTotal = firstPartyRatings.reduce((sum, rating) => sum + rating, 0);
  const seedCount = Math.max(0, sourceReviewCount);
  const seedRating =
    typeof sourceGuestRating === "number" && Number.isFinite(sourceGuestRating)
      ? sourceGuestRating
      : undefined;

  if (firstPartyCount === 0) {
    return seedRating;
  }
  if (seedRating === undefined || seedCount === 0) {
    return roundMetric(firstPartyTotal / firstPartyCount);
  }

  return roundMetric(
    ((seedRating * seedCount) + firstPartyTotal) / (seedCount + firstPartyCount),
  );
}
