import type { RuntimeFacet } from "./facets.js";

export type ReliabilityClass = "high" | "medium" | "low" | "blocked";
export type SessionSentiment = "positive" | "negative" | "mixed" | "neutral";
export type PropertySourceVendor = "expedia";
export type PropertyValidationStatus = "idle" | "refreshing" | "success" | "error";

export interface PropertyRecord {
  propertyId: string;
  city?: string;
  province?: string;
  country?: string;
  starRating?: number;
  guestRating?: number;
  propertySummary: string;
  popularAmenities?: string;
  facetListingTexts: Partial<Record<RuntimeFacet, string>>;
  demoScenario?: string;
  demoFlags: string[];
  sourceVendor?: PropertySourceVendor;
  sourceUrl?: string;
  lastValidatedAt?: string;
  validationStatus?: PropertyValidationStatus;
  liveReviewCount?: number;
}

export interface PropertyFacetMetric {
  propertyId: string;
  facet: RuntimeFacet;
  importance: number;
  threshold: number;
  reliabilityClass: ReliabilityClass;
  daysSince: number;
  stalenessScore: number;
  mentionRate: number;
  matchedReviewRate: number;
  meanCosMatchedReviews: number;
  validatedConflictCount: number;
  validatedConflictScore: number;
  listingTextPresent: boolean;
}

export interface PropertyFacetEvidence {
  propertyId: string;
  facet: RuntimeFacet;
  sourceType:
    | "validated_conflict"
    | "listing_summary"
    | "demo_scenario"
    | "expedia_listing"
    | "expedia_review";
  snippet: string;
  acquisitionDate?: string;
  evidenceScore?: number;
}

export interface LiveReviewSample {
  propertyId: string;
  sourceVendor: PropertySourceVendor;
  sourceUrl: string;
  reviewIdHash: string;
  headline?: string;
  text: string;
  rating?: number;
  reviewDate?: string;
  reviewerType?: string;
  fetchedAt: string;
}

export interface PropertyFacetLiveSignal {
  propertyId: string;
  facet: RuntimeFacet;
  mentionRate: number;
  conflictScore: number;
  latestReviewDate?: string;
  daysSince: number;
  listingTextPresent: boolean;
  reviewCountSampled: number;
  supportSnippetCount: number;
  fetchedAt: string;
}

export interface PropertyValidationState {
  propertyId: string;
  sourceVendor?: PropertySourceVendor;
  sourceUrl?: string;
  lastValidatedAt?: string;
  validationStatus: PropertyValidationStatus;
  liveReviewCount: number;
}

export interface ImportedExpediaPropertySnapshot {
  propertyId: string;
  sourceVendor: "expedia";
  sourceUrl: string;
  propertySummary: string;
  popularAmenities?: string;
  city?: string;
  province?: string;
  country?: string;
  guestRating?: number;
  facetListingTexts: Partial<Record<RuntimeFacet, string>>;
  reviews: Array<{
    headline?: string;
    text: string;
    rating?: number;
    reviewDate?: string;
    reviewerType?: string;
  }>;
  demoFlags: string[];
  demoScenario?: string;
  importedAt: string;
}

export interface EligibleFacetSummary {
  facet: RuntimeFacet;
  reliabilityClass: ReliabilityClass;
  importance: number;
}

export interface ScoreBreakdown {
  importance: number;
  staleness: number;
  conflict: number;
  coverageGap: number;
  matchedSupportGap: number;
  alreadyMentionedPenalty: number;
  reviewerKnowsBoost: number;
  total: number;
}

export interface ReviewAnalysisResult {
  mentionedFacets: RuntimeFacet[];
  likelyKnownFacets: RuntimeFacet[];
  sentiment: SessionSentiment;
  mlMentionProbByFacet: Partial<Record<RuntimeFacet, number>>;
  mlLikelyKnownByFacet: Partial<Record<RuntimeFacet, number>>;
  usedML: boolean;
  usedOpenAI: boolean;
  usedFallback: boolean;
}

export interface SourceDiagnostics {
  usedOpenAI: boolean;
  usedFallback: boolean;
}

export interface StructuredFact {
  facet: RuntimeFacet;
  factType: string;
  value: string | number | boolean;
  confidence: number;
}

export interface PropertyCardDelta {
  summary: string;
  addedFacts: StructuredFact[];
}

export interface SelectNextQuestionResult {
  facet: RuntimeFacet | null;
  questionText: string | null;
  voiceText: string | null;
  whyThisQuestion: string;
  scoreBreakdown: ScoreBreakdown | null;
  supportingEvidence: PropertyFacetEvidence[];
  analysis: ReviewAnalysisResult | null;
  questionSource: SourceDiagnostics | null;
  noFollowUp: boolean;
}

export interface SubmitFollowUpAnswerResult {
  structuredFacts: StructuredFact[];
  confidence: number;
  propertyCardDelta: PropertyCardDelta;
  usedOpenAI: boolean;
  usedFallback: boolean;
}

export interface StoredReviewSession {
  id: string;
  propertyId: string;
  draftReview: string;
  selectedFacet: RuntimeFacet | null;
  mentionedFacets: RuntimeFacet[];
  likelyKnownFacets: RuntimeFacet[];
  mlMentionProbByFacet: Partial<Record<RuntimeFacet, number>>;
  mlLikelyKnownByFacet: Partial<Record<RuntimeFacet, number>>;
  usedML: boolean;
  usedOpenAI: boolean;
  usedFallback: boolean;
  sentiment: SessionSentiment;
  createdAt: string;
  updatedAt: string;
}

export interface StoredFollowUpQuestion {
  id: string;
  sessionId: string;
  facet: RuntimeFacet;
  questionText: string;
  voiceText: string;
  whyThisQuestion: string;
  scoreBreakdown: ScoreBreakdown;
  supportingEvidence: PropertyFacetEvidence[];
  usedOpenAI: boolean;
  usedFallback: boolean;
  createdAt: string;
}

export interface StoredFollowUpAnswer {
  id: string;
  sessionId: string;
  facet: RuntimeFacet;
  answerText: string;
  structuredFacts: StructuredFact[];
  confidence: number;
  usedOpenAI: boolean;
  usedFallback: boolean;
  createdAt: string;
}

export interface PropertyEvidenceUpdate {
  id: string;
  propertyId: string;
  facet: RuntimeFacet;
  factType: string;
  value: string | number | boolean;
  confidence: number;
  sourceSessionId: string;
  createdAt: string;
  rawFact: StructuredFact;
}

export interface CreateReviewSessionInput {
  propertyId: string;
  draftReview?: string;
}

export interface CreateReviewSessionResult {
  sessionId: string;
  propertySummary: PropertyRecord;
  eligibleFacets: EligibleFacetSummary[];
}

export interface AnalyzeDraftReviewInput {
  sessionId: string;
  draftReview: string;
}

export interface SelectNextQuestionInput {
  sessionId: string;
  draftReview: string;
  includeSecondaryFacets?: boolean;
}

export interface SubmitFollowUpAnswerInput {
  sessionId: string;
  facet: RuntimeFacet;
  answerText: string;
}

export interface SessionSummary {
  draftReview: string;
  selectedFacet: RuntimeFacet | null;
  askedQuestion: StoredFollowUpQuestion | null;
  answer: StoredFollowUpAnswer | null;
  extractedFacts: StructuredFact[];
  accumulatedEvidenceUpdates: PropertyEvidenceUpdate[];
}
