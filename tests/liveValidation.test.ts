import { describe, expect, it } from "vitest";

import { InMemoryReviewGapStore } from "../src/backend/store.js";
import {
  importExpediaPropertySnapshot,
  validatePropertyFromExpediaUrl,
} from "../src/backend/liveValidation.js";
import type { PropertySourceProvider } from "../src/backend/propertySource.js";

describe("live validation", () => {
  it("succeeds with listing-only data when no visible review snippets are extracted", async () => {
    const store = new InMemoryReviewGapStore();
    await store.upsertProperty({
      propertyId: "property_1",
      city: "Austin",
      province: "Texas",
      country: "United States",
      propertySummary: "Seeded summary",
      facetListingTexts: {},
      demoFlags: ["demo"],
    });

    const provider: PropertySourceProvider = {
      vendor: "expedia",
      normalizeUrl(url) {
        return url;
      },
      async scrapeProperty() {
        return {
          markdown: `
# Mock Property
Austin, Texas, United States

Updated listing description with breakfast and parking.

## Popular amenities
Breakfast available
Self parking
`,
          metadata: {
            title: "Mock Property, Austin",
            description: "Updated listing description with breakfast and parking.",
          },
        };
      },
    };

    const result = await validatePropertyFromExpediaUrl(
      store,
      provider,
      {
        propertyId: "property_1",
        expediaUrl: "https://www.expedia.com/Hotel-Information",
      },
      undefined,
    );

    expect(result.sampledReviewCount).toBe(0);
    expect(result.validationState.validationStatus).toBe("success");
    expect(result.property.propertySummary).toContain("Updated listing description");
    expect(result.property.liveReviewCount).toBe(0);
  });

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
