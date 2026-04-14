import { describe, expect, it } from "vitest";

import {
  buildExpediaFacetEvidence,
  deriveLiveFacetSignals,
  extractExpediaSnapshot,
  normalizeExpediaPropertyUrl,
} from "../src/backend/propertySource.js";

const VALID_MARKDOWN = `
# The Mockingbird Hotel
Austin, Texas, United States

Modern downtown stay close to the convention center with rooftop pool and valet parking.

## Popular amenities
Free WiFi
Breakfast available
Valet parking
Outdoor pool

## Check-in
Check-in starts at 4:00 PM. Front desk staff can help with late arrivals.

## Parking
Valet parking is available for USD 32 per day.

## Breakfast
Buffet breakfast is served every morning.

## Guest reviews
### 8/10 Good
Family traveler
January 12, 2026
Parking was tight and valet charged $32, but check-in was quick and the breakfast buffet stayed stocked.

### 9/10 Great
Couple traveler
2026-03-02
Pool was open and clean. Breakfast was worth it.
`;

const MISSING_DATE_MARKDOWN = `
# Harbor Stay
Portland, Oregon, United States

## Guest reviews
### 8/10 Good
Business traveler
Breakfast was decent, but parking was expensive.
`;

const SPARSE_AMENITIES_MARKDOWN = `
# Quiet Corner Hotel
Santa Fe, New Mexico, United States

Boutique stay near the plaza.

## Guest reviews
### 7/10 Fine
Solo traveler
2026-01-18
The room was quiet and clean.
`;

describe("property source helpers", () => {
  it("normalizes Expedia hotel URLs and strips transient params", () => {
    const normalized = normalizeExpediaPropertyUrl(
      "https://www.expedia.com/Hotel-Information?h=1&chkin=2026-05-01&chkout=2026-05-02#overview",
    );

    expect(normalized).toBe("https://www.expedia.com/Hotel-Information?h=1");
  });

  it("rejects non-hotel Expedia pages", () => {
    expect(() =>
      normalizeExpediaPropertyUrl("https://www.expedia.com/Hotels-Search"),
    ).toThrow("Paste an Expedia hotel page URL");
  });

  it("extracts listing facts and visible reviews from a valid scrape", () => {
    const snapshot = extractExpediaSnapshot(
      {
        markdown: VALID_MARKDOWN,
        metadata: {
          title: "The Mockingbird Hotel, Austin",
          description: "Modern downtown stay close to the convention center with rooftop pool and valet parking.",
        },
      },
      "https://www.expedia.com/Hotel-Information",
    );

    expect(snapshot.city).toBe("Austin");
    expect(snapshot.province).toBe("Texas");
    expect(snapshot.country).toBe("United States");
    expect(snapshot.propertySummary).toContain("downtown stay");
    expect(snapshot.popularAmenities).toContain("Breakfast available");
    expect(snapshot.facetListingTexts.amenities_parking).toContain("parking");
    expect(snapshot.reviews).toHaveLength(2);
  });

  it("handles sparse amenities and malformed review sections conservatively", () => {
    const snapshot = extractExpediaSnapshot(
      {
        markdown: SPARSE_AMENITIES_MARKDOWN,
        metadata: { title: "Quiet Corner Hotel, Santa Fe" },
      },
      "https://www.expedia.com/Hotel-Information",
    );

    expect(snapshot.popularAmenities).toBeUndefined();
    expect(snapshot.reviews[0]?.text).toContain("quiet and clean");
  });

  it("keeps reviews without dates but marks them stale in live signals", () => {
    const snapshot = extractExpediaSnapshot(
      {
        markdown: MISSING_DATE_MARKDOWN,
        metadata: { title: "Harbor Stay, Portland" },
      },
      "https://www.expedia.com/Hotel-Information",
    );
    const signals = deriveLiveFacetSignals(
      "property_1",
      snapshot,
      undefined,
      "2026-04-14T00:00:00.000Z",
    );
    const breakfast = signals.find((signal) => signal.facet === "amenities_breakfast");

    expect(snapshot.reviews[0]?.reviewDate).toBeUndefined();
    expect(breakfast?.daysSince).toBe(9999);
  });

  it("derives fresh mention and conflict signals from scraped reviews", () => {
    const snapshot = extractExpediaSnapshot(
      {
        markdown: VALID_MARKDOWN,
        metadata: { title: "The Mockingbird Hotel, Austin" },
      },
      "https://www.expedia.com/Hotel-Information",
    );
    const signals = deriveLiveFacetSignals(
      "property_1",
      snapshot,
      undefined,
      "2026-04-14T00:00:00.000Z",
    );
    const parking = signals.find((signal) => signal.facet === "amenities_parking");
    const pool = signals.find((signal) => signal.facet === "amenities_pool");
    const gym = signals.find((signal) => signal.facet === "amenities_gym");

    expect(parking?.mentionRate).toBeGreaterThan(0);
    expect(parking?.conflictScore).toBeGreaterThan(0);
    expect(pool?.daysSince).toBe(43);
    expect(gym?.listingTextPresent).toBe(false);
    expect(gym?.conflictScore).toBe(0);
  });

  it("builds replaceable Expedia evidence snippets per facet", () => {
    const snapshot = extractExpediaSnapshot(
      {
        markdown: VALID_MARKDOWN,
        metadata: { title: "The Mockingbird Hotel, Austin" },
      },
      "https://www.expedia.com/Hotel-Information",
    );
    const evidence = buildExpediaFacetEvidence("property_1", snapshot, undefined);

    expect(evidence.amenities_parking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: "expedia_listing" }),
        expect.objectContaining({ sourceType: "expedia_review" }),
      ]),
    );
  });
});
