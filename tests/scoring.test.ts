import { describe, expect, it } from "vitest";

import { extractAnswerFactsFallback, generateQuestionFallback } from "../src/backend/fallbacks.js";
import { isFacetEligible, rankFacetMetrics } from "../src/backend/scoring.js";
import { buildWhyThisQuestion } from "../src/backend/whyThisQuestion.js";
import type { PropertyFacetMetric, PropertyRecord } from "../src/backend/types.js";

const property: PropertyRecord = {
  propertyId: "property_1",
  city: "Frisco",
  province: "Texas",
  country: "United States",
  propertySummary: "Frisco, Texas. Demo property.",
  popularAmenities: "free parking",
  facetListingTexts: {
    check_in: "check_in_start_time: 3:00 PM",
    amenities_breakfast: "property_description: breakfast available",
    amenities_parking: "property_description: free parking",
  },
  demoFlags: [],
};

describe("scoring and fallbacks", () => {
  it("blocks pet from MVP auto-selection", () => {
    const metric: PropertyFacetMetric = {
      propertyId: "property_1",
      facet: "pet",
      importance: 0.3,
      threshold: 0.45,
      reliabilityClass: "blocked",
      daysSince: 9999,
      stalenessScore: 1,
      mentionRate: 0,
      matchedReviewRate: 0,
      meanCosMatchedReviews: 0,
      validatedConflictCount: 0,
      validatedConflictScore: 0,
      listingTextPresent: true,
    };
    expect(isFacetEligible(metric)).toBe(false);
  });

  it("ranks facets deterministically from the score components", () => {
    const metrics: PropertyFacetMetric[] = [
      {
        propertyId: "property_1",
        facet: "check_in",
        importance: 0.95,
        threshold: 0.45,
        reliabilityClass: "high",
        daysSince: 300,
        stalenessScore: 0.82,
        mentionRate: 0.02,
        matchedReviewRate: 0.04,
        meanCosMatchedReviews: 0.34,
        validatedConflictCount: 2,
        validatedConflictScore: 0.048,
        listingTextPresent: true,
      },
      {
        propertyId: "property_1",
        facet: "amenities_breakfast",
        importance: 0.9,
        threshold: 0.4,
        reliabilityClass: "high",
        daysSince: 90,
        stalenessScore: 0.25,
        mentionRate: 0.03,
        matchedReviewRate: 0.03,
        meanCosMatchedReviews: 0.38,
        validatedConflictCount: 1,
        validatedConflictScore: 0.035,
        listingTextPresent: true,
      },
    ];

    const ranked = rankFacetMetrics(metrics, {
      mentionedFacets: [],
      likelyKnownFacets: [],
    });

    expect(ranked[0]?.facet).toBe("check_in");
    expect(ranked[0]?.scoreBreakdown.total).toBe(0.809);
    expect(ranked[1]?.scoreBreakdown.total).toBe(0.615);
  });

  it("uses facet-specific fallback question templates", () => {
    const question = generateQuestionFallback({
      facet: "amenities_parking",
      property,
    });
    expect(question.questionText).toContain("parking");
    expect(question.voiceText).toContain("parking");
  });

  it("extracts conservative fallback facts from answers", () => {
    const result = extractAnswerFactsFallback({
      facet: "check_in",
      answerText: "We waited 20 minutes and the room was not ready until 4:15 pm.",
    });
    expect(result.structuredFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factType: "wait_minutes", value: 20 }),
        expect.objectContaining({ factType: "observed_time", value: "4:15pm" }),
      ]),
    );
  });

  it("formats a deterministic why-asked explanation", () => {
    const why = buildWhyThisQuestion(
      "amenities_parking",
      {
        importance: 0.23,
        staleness: 0.19,
        conflict: 0.12,
        coverageGap: 0.14,
        matchedSupportGap: 0.1,
        alreadyMentionedPenalty: 0,
        reviewerKnowsBoost: 0,
        total: 0.78,
      },
      [
        {
          propertyId: "property_1",
          facet: "amenities_parking",
          sourceType: "validated_conflict",
          snippet: "Guests reported tight parking and overflow into a nearby lot.",
          evidenceScore: 0.9,
        },
      ],
    );
    expect(why).toContain("validated conflicting guest evidence");
    expect(why).toContain("Guests reported tight parking");
  });
});
