import { describe, expect, it } from "vitest";

import { InMemoryReviewGapStore } from "../src/backend/store.js";
import { importExpediaPropertySnapshot } from "../src/backend/liveValidation.js";

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
});
