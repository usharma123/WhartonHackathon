import type { RuntimeFacet } from "./facets.js";

export type ReliabilityClass = "high" | "medium" | "low" | "blocked";
export type SessionSentiment = "positive" | "negative" | "mixed" | "neutral";

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
  sourceType: "validated_conflict" | "listing_summary" | "demo_scenario";
  snippet: string;
  acquisitionDate?: string;
  evidenceScore?: number;
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
  noFollowUp: boolean;
}

export interface SubmitFollowUpAnswerResult {
  structuredFacts: StructuredFact[];
  confidence: number;
  propertyCardDelta: PropertyCardDelta;
  usedFallback: boolean;
}

export interface StoredReviewSession {
  id: string;
  propertyId: string;
  draftReview: string;
  selectedFacet: RuntimeFacet | null;
  mentionedFacets: RuntimeFacet[];
  likelyKnownFacets: RuntimeFacet[];
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
  createdAt: string;
}

export interface StoredFollowUpAnswer {
  id: string;
  sessionId: string;
  facet: RuntimeFacet;
  answerText: string;
  structuredFacts: StructuredFact[];
  confidence: number;
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
