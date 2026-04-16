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

const probabilityEntryValidator = v.object({
  facet: v.string(),
  value: v.number(),
});

const structuredFactValidator = v.object({
  facet: v.string(),
  factType: v.string(),
  value: factValue,
  confidence: v.number(),
  firsthandConfidence: v.optional(v.number()),
  polarity: v.optional(v.string()),
  severity: v.optional(v.string()),
  resolved: v.optional(v.boolean()),
  sourceSnippet: v.optional(v.string()),
});

const aspectRatingsValidator = v.object({
  service: v.optional(v.number()),
  cleanliness: v.optional(v.number()),
  amenities: v.optional(v.number()),
  value: v.optional(v.number()),
});

const tripContextValidator = v.object({
  tripType: v.optional(v.string()),
  stayLengthBucket: v.optional(v.string()),
  arrivalTimeBucket: v.optional(v.string()),
  roomType: v.optional(v.string()),
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
  rankerSource: v.optional(v.string()),
  baseModelVersion: v.optional(v.string()),
  baseScore: v.optional(v.number()),
  sessionAdjustment: v.optional(v.number()),
  finalScore: v.optional(v.number()),
  heuristicScore: v.optional(v.number()),
  sampleSize: v.optional(v.number()),
  evidenceMix: v.optional(v.string()),
  topDriver: v.optional(v.string()),
});

export default defineSchema({
  sourceProperties: defineTable({
    propertyId: v.string(),
    guestRatingAvgExpedia: v.string(),
    city: v.string(),
    province: v.string(),
    country: v.string(),
    starRating: v.string(),
    areaDescription: v.string(),
    propertyDescription: v.string(),
    popularAmenitiesList: v.string(),
    propertyAmenityAccessibility: v.string(),
    propertyAmenityActivitiesNearby: v.string(),
    propertyAmenityBusinessServices: v.string(),
    propertyAmenityConveniences: v.string(),
    propertyAmenityFamilyFriendly: v.string(),
    propertyAmenityFoodAndDrink: v.string(),
    propertyAmenityGuestServices: v.string(),
    propertyAmenityInternet: v.string(),
    propertyAmenityLangsSpoken: v.string(),
    propertyAmenityMore: v.string(),
    propertyAmenityOutdoor: v.string(),
    propertyAmenityParking: v.string(),
    propertyAmenitySpa: v.string(),
    propertyAmenityThingsToDo: v.string(),
    checkInStartTime: v.string(),
    checkInEndTime: v.string(),
    checkOutTime: v.string(),
    checkOutPolicy: v.string(),
    petPolicy: v.string(),
    childrenAndExtraBedPolicy: v.string(),
    checkInInstructions: v.string(),
    knowBeforeYouGo: v.string(),
  }).index("by_property_id", ["propertyId"]),

  sourceReviews: defineTable({
    propertyId: v.string(),
    acquisitionDate: v.string(),
    lob: v.string(),
    ratingJson: v.string(),
    reviewTitle: v.string(),
    reviewText: v.string(),
  })
    .index("by_property_id", ["propertyId"])
    .index("by_property_id_and_acquisition_date", ["propertyId", "acquisitionDate"]),

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
    sourceVendor: v.optional(v.literal("expedia")),
    sourceUrl: v.optional(v.string()),
    lastValidatedAt: v.optional(v.string()),
    validationStatus: v.optional(
      v.union(
        v.literal("idle"),
        v.literal("refreshing"),
        v.literal("success"),
        v.literal("error"),
      ),
    ),
    vendorReviewCount: v.optional(v.number()),
    firstPartyReviewCount: v.optional(v.number()),
    liveReviewCount: v.optional(v.number()),
    lastRecomputedAt: v.optional(v.string()),
    recomputeStatus: v.optional(
      v.union(
        v.literal("idle"),
        v.literal("recomputing"),
        v.literal("ready"),
        v.literal("error"),
      ),
    ),
    recomputeSourceVersion: v.optional(v.number()),
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
    sampleSize: v.optional(v.number()),
    vendorSampleSize: v.optional(v.number()),
    firstPartySampleSize: v.optional(v.number()),
    sampleConfidence: v.optional(v.number()),
    evidenceMix: v.optional(v.string()),
    topDriver: v.optional(v.string()),
  })
    .index("by_property_id", ["propertyId"])
    .index("by_property_id_facet", ["propertyId", "facet"]),

  propertyFacetEvidence: defineTable(evidenceValidator)
    .index("by_property_id", ["propertyId"])
    .index("by_property_id_facet", ["propertyId", "facet"]),

  propertyLiveReviews: defineTable({
    propertyId: v.string(),
    sourceVendor: v.union(v.literal("expedia"), v.literal("first_party")),
    sourceUrl: v.optional(v.string()),
    reviewIdHash: v.string(),
    headline: v.optional(v.string()),
    text: v.string(),
    rating: v.optional(v.number()),
    reviewDate: v.optional(v.string()),
    reviewerType: v.optional(v.string()),
    tokenIdentifier: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    fetchedAt: v.string(),
  })
    .index("by_property_id", ["propertyId"])
    .index("by_property_id_and_review_id_hash", ["propertyId", "reviewIdHash"]),

  userPropertyReviews: defineTable({
    propertyId: v.string(),
    tokenIdentifier: v.string(),
    sessionId: v.string(),
    reviewText: v.string(),
    overallRating: v.optional(v.number()),
    aspectRatings: v.optional(aspectRatingsValidator),
    sentiment: v.string(),
    answerCount: v.number(),
    factCount: v.number(),
    tripContext: v.optional(tripContextValidator),
    submissionCount: v.optional(v.number()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_property_id", ["propertyId"])
    .index("by_token_identifier", ["tokenIdentifier"])
    .index("by_property_id_and_token_identifier", ["propertyId", "tokenIdentifier"])
    .index("by_session_id", ["sessionId"]),

  propertyFacetLiveSignals: defineTable({
    propertyId: v.string(),
    facet: v.string(),
    mentionRate: v.number(),
    conflictScore: v.number(),
    latestReviewDate: v.optional(v.string()),
    daysSince: v.number(),
    listingTextPresent: v.boolean(),
    reviewCountSampled: v.number(),
    supportSnippetCount: v.number(),
    vendorReviewCountSampled: v.optional(v.number()),
    vendorSupportSnippetCount: v.optional(v.number()),
    firstPartyReviewCountSampled: v.optional(v.number()),
    firstPartySupportSnippetCount: v.optional(v.number()),
    sampleConfidence: v.optional(v.number()),
    weightedSupportRate: v.optional(v.number()),
    evidenceMix: v.optional(v.string()),
    topDriver: v.optional(v.string()),
    fetchedAt: v.string(),
  })
    .index("by_property_id", ["propertyId"])
    .index("by_property_id_and_facet", ["propertyId", "facet"]),

  reviewSessions: defineTable({
    propertyId: v.string(),
    tokenIdentifier: v.optional(v.string()),
    draftReview: v.string(),
    conversationStage: v.optional(v.string()),
    clarifierCount: v.optional(v.number()),
    overallRating: v.optional(v.number()),
    aspectRatings: v.optional(aspectRatingsValidator),
    selectedFacet: v.optional(v.string()),
    mentionedFacets: v.array(v.string()),
    likelyKnownFacets: v.array(v.string()),
    mlMentionProbByFacet: v.array(probabilityEntryValidator),
    mlLikelyKnownByFacet: v.array(probabilityEntryValidator),
    usedML: v.boolean(),
    usedOpenAI: v.boolean(),
    usedFallback: v.boolean(),
    sentiment: v.string(),
    tripContext: v.optional(tripContextValidator),
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
    usedOpenAI: v.boolean(),
    usedFallback: v.boolean(),
    createdAt: v.string(),
  }).index("by_session_id", ["sessionId"]),

  followUpAnswers: defineTable({
    sessionId: v.string(),
    facet: v.string(),
    answerText: v.string(),
    structuredFacts: v.array(structuredFactValidator),
    confidence: v.number(),
    usedOpenAI: v.boolean(),
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

  mlRuntimeArtifacts: defineTable({
    artifactType: v.string(),
    version: v.string(),
    generatedAt: v.string(),
    tokenizer: v.object({
      regex: v.string(),
      minTokenLength: v.number(),
      ngramRange: v.array(v.number()),
      lowercase: v.boolean(),
      stripAccents: v.boolean(),
      l2Normalize: v.boolean(),
    }),
    runtimeFacets: v.array(v.string()),
    vocabularyEntries: v.array(
      v.object({
        term: v.string(),
        index: v.number(),
      }),
    ),
    terms: v.array(v.string()),
    idf: v.array(v.number()),
    models: v.array(
      v.object({
        facet: v.string(),
        intercept: v.number(),
        threshold: v.number(),
        coefficients: v.array(v.number()),
        topPositiveTerms: v.array(v.string()),
        topNegativeTerms: v.array(v.string()),
        metrics: v.object({
          trainingRows: v.number(),
          validationRows: v.number(),
          positiveRate: v.number(),
          rocAuc: v.number(),
          f1: v.number(),
          precision: v.number(),
          recall: v.number(),
        }),
      }),
    ),
  }).index("by_artifact_type", ["artifactType"]),

  learnedRankerArtifacts: defineTable({
    artifactType: v.string(),
    version: v.string(),
    generatedAt: v.string(),
    modelKind: v.union(v.literal("linear"), v.literal("tree")),
    featureKeys: v.array(v.string()),
    featureStats: v.optional(
      v.array(
        v.object({
          mean: v.number(),
          std: v.number(),
        }),
      ),
    ),
    coefficients: v.optional(v.array(v.number())),
    intercept: v.optional(v.number()),
    treePayloadJson: v.optional(v.string()),
    temporalMetricsJson: v.optional(v.string()),
    manualMetricsJson: v.optional(v.string()),
    notes: v.optional(v.array(v.string())),
  }).index("by_artifact_type", ["artifactType"]),

  rankerShadowEvents: defineTable({
    sessionId: v.string(),
    propertyId: v.string(),
    draftReviewHash: v.string(),
    heuristicTop3: v.array(v.string()),
    learnedTop3: v.array(v.string()),
    servedTop3: v.array(v.string()),
    finalServedFacet: v.optional(v.string()),
    rankerSource: v.string(),
    baseModelVersion: v.optional(v.string()),
    disagreed: v.boolean(),
    createdAt: v.string(),
  })
    .index("by_session_id", ["sessionId"])
    .index("by_property_id", ["propertyId"]),
});
