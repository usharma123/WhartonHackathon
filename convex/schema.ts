import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const factValue = v.union(v.string(), v.number(), v.boolean());

const evidenceValidator = v.object({
  propertyId: v.string(),
  facet: v.string(),
  sourceType: v.string(),
  snippet: v.string(),
  acquisitionDate: v.optional(v.string()),
  evidenceScore: v.optional(v.number()),
});

const structuredFactValidator = v.object({
  facet: v.string(),
  factType: v.string(),
  value: factValue,
  confidence: v.number(),
});

const scoreBreakdownValidator = v.object({
  importance: v.number(),
  staleness: v.number(),
  conflict: v.number(),
  coverageGap: v.number(),
  matchedSupportGap: v.number(),
  alreadyMentionedPenalty: v.number(),
  reviewerKnowsBoost: v.number(),
  total: v.number(),
});

export default defineSchema({
  properties: defineTable({
    propertyId: v.string(),
    city: v.optional(v.string()),
    province: v.optional(v.string()),
    country: v.optional(v.string()),
    starRating: v.optional(v.number()),
    guestRating: v.optional(v.number()),
    propertySummary: v.string(),
    popularAmenities: v.optional(v.string()),
    facetListingTexts: v.array(
      v.object({
        facet: v.string(),
        text: v.string(),
      }),
    ),
    demoScenario: v.optional(v.string()),
    demoFlags: v.array(v.string()),
  }).index("by_property_id", ["propertyId"]),

  propertyFacetMetrics: defineTable({
    propertyId: v.string(),
    facet: v.string(),
    importance: v.number(),
    threshold: v.number(),
    reliabilityClass: v.string(),
    daysSince: v.number(),
    stalenessScore: v.number(),
    mentionRate: v.number(),
    matchedReviewRate: v.number(),
    meanCosMatchedReviews: v.number(),
    validatedConflictCount: v.number(),
    validatedConflictScore: v.number(),
    listingTextPresent: v.boolean(),
  })
    .index("by_property_id", ["propertyId"])
    .index("by_property_id_facet", ["propertyId", "facet"]),

  propertyFacetEvidence: defineTable(evidenceValidator)
    .index("by_property_id", ["propertyId"])
    .index("by_property_id_facet", ["propertyId", "facet"]),

  reviewSessions: defineTable({
    propertyId: v.string(),
    draftReview: v.string(),
    selectedFacet: v.optional(v.string()),
    mentionedFacets: v.array(v.string()),
    likelyKnownFacets: v.array(v.string()),
    sentiment: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_property_id", ["propertyId"]),

  followUpQuestions: defineTable({
    sessionId: v.string(),
    facet: v.string(),
    questionText: v.string(),
    voiceText: v.string(),
    whyThisQuestion: v.string(),
    scoreBreakdown: scoreBreakdownValidator,
    supportingEvidence: v.array(evidenceValidator),
    createdAt: v.string(),
  }).index("by_session_id", ["sessionId"]),

  followUpAnswers: defineTable({
    sessionId: v.string(),
    facet: v.string(),
    answerText: v.string(),
    structuredFacts: v.array(structuredFactValidator),
    confidence: v.number(),
    usedFallback: v.boolean(),
    createdAt: v.string(),
  }).index("by_session_id", ["sessionId"]),

  propertyEvidenceUpdates: defineTable({
    propertyId: v.string(),
    facet: v.string(),
    factType: v.string(),
    value: factValue,
    confidence: v.number(),
    sourceSessionId: v.string(),
    createdAt: v.string(),
    rawFact: structuredFactValidator,
  })
    .index("by_property_id_facet", ["propertyId", "facet"])
    .index("by_source_session_id", ["sourceSessionId"]),
});
