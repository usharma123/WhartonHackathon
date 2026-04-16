import { describe, expect, it } from "vitest";

import { InMemoryReviewGapStore } from "../src/backend/store.js";
import { importExpediaPropertySnapshot } from "../src/backend/liveValidation.js";
import { buildFirstPartyLiveReviewSample } from "../src/backend/propertySource.js";

describe("live validation", () => {
  it("imports a new Expedia property snapshot and bootstraps metrics", async () => {
    const store = new InMemoryReviewGapStore();

    const result = await importExpediaPropertySnapshot(
      store,
      {
        propertyId: "expedia_new_1",
        sourceVendor: "expedia",
        sourceUrl: "https://www.expedia.com/Hotel-Information",
        propertySummary: "Fresh Expedia import with parking and breakfast.",
        popularAmenities: "Breakfast available, Self parking",
        city: "Austin",
        province: "Texas",
        country: "United States",
        guestRating: 8.8,
        facetListingTexts: {
          amenities_breakfast: "Breakfast available daily",
          amenities_parking: "Self parking on site",
        },
        reviews: [
          {
            text: "Breakfast was better than expected and parking was easy.",
            reviewDate: "2026-04-12",
          },
        ],
        demoFlags: ["demo", "expedia_seed"],
        demoScenario: "expedia_seed",
        importedAt: "2026-04-14T00:00:00.000Z",
      },
      undefined,
    );

    expect(result.validationState.validationStatus).toBe("success");
    expect(result.sampledReviewCount).toBe(1);
    expect(result.property.city).toBe("Austin");
    expect((await store.listPropertyFacetMetrics("expedia_new_1")).length).toBeGreaterThan(0);
  });

  it("preserves first-party reviews and recompute metadata across vendor refreshes", async () => {
    const store = new InMemoryReviewGapStore();
    const propertyId = "expedia_refresh_1";

    await importExpediaPropertySnapshot(
      store,
      {
        propertyId,
        sourceVendor: "expedia",
        sourceUrl: "https://www.expedia.com/Hotel-Information",
        propertySummary: "Initial Expedia import with parking and breakfast.",
        popularAmenities: "Breakfast available, Self parking",
        city: "Austin",
        province: "Texas",
        country: "United States",
        guestRating: 8.6,
        facetListingTexts: {
          amenities_breakfast: "Breakfast available daily",
          amenities_parking: "Self parking on site",
        },
        reviews: [
          {
            text: "Parking was easy and breakfast was decent.",
            reviewDate: "2026-04-12",
          },
        ],
        demoFlags: ["demo"],
        importedAt: "2026-04-14T00:00:00.000Z",
      },
      undefined,
    );

    await store.upsertUserPropertyReview({
      propertyId,
      tokenIdentifier: "clerk:user_1",
      sessionId: "session_1",
      reviewText: "We waited a bit at check-in, but parking was simple once we found the garage.",
      overallRating: 7,
      aspectRatings: { service: 3, amenities: 4 },
      sentiment: "mixed",
      answerCount: 1,
      factCount: 2,
      tripContext: { tripType: "family", stayLengthBucket: "2_3_nights" },
      submissionCount: 1,
      createdAt: "2026-04-14T12:00:00.000Z",
      updatedAt: "2026-04-14T12:00:00.000Z",
    });
    await store.upsertPropertyLiveReview(
      buildFirstPartyLiveReviewSample({
        propertyId,
        tokenIdentifier: "clerk:user_1",
        sessionId: "session_1",
        text: "We waited a bit at check-in, but parking was simple once we found the garage.",
        reviewDate: "2026-04-14T12:00:00.000Z",
      }),
    );

    const refreshed = await importExpediaPropertySnapshot(
      store,
      {
        propertyId,
        sourceVendor: "expedia",
        sourceUrl: "https://www.expedia.com/Hotel-Information",
        propertySummary: "Refreshed Expedia import with updated parking text.",
        popularAmenities: "Breakfast available, Covered self parking",
        city: "Austin",
        province: "Texas",
        country: "United States",
        guestRating: 8.7,
        facetListingTexts: {
          amenities_breakfast: "Breakfast available daily",
          amenities_parking: "Covered self parking on site",
        },
        reviews: [
          {
            text: "Parking was tighter this time but still manageable.",
            reviewDate: "2026-04-15",
          },
          {
            text: "Breakfast got crowded early in the morning.",
            reviewDate: "2026-04-15",
          },
        ],
        demoFlags: ["demo"],
        importedAt: "2026-04-15T00:00:00.000Z",
      },
      undefined,
    );

    const liveReviews = await store.listPropertyLiveReviews(propertyId);
    const firstPartyReviews = liveReviews.filter((review) => review.sourceVendor === "first_party");

    expect(firstPartyReviews).toHaveLength(1);
    expect(refreshed.property.vendorReviewCount).toBe(2);
    expect(refreshed.property.firstPartyReviewCount).toBe(1);
    expect(refreshed.property.liveReviewCount).toBe(3);
    expect(refreshed.property.recomputeStatus).toBe("ready");
    expect(refreshed.property.lastRecomputedAt).toBe("2026-04-15T00:00:00.000Z");
    expect(refreshed.property.recomputeSourceVersion).toBe(2);
    expect(refreshed.validationState.liveReviewCount).toBe(3);
    expect(refreshed.validationState.firstPartyReviewCount).toBe(1);
  });
});
