import type { RuntimeFacet } from "./facets.js";

export type ReliabilityClass = "high" | "medium" | "low" | "blocked";
export type SessionSentiment = "positive" | "negative" | "mixed" | "neutral";
export type PropertySourceVendor = "expedia" | "first_party";
export type PropertyValidationStatus = "idle" | "refreshing" | "success" | "error";
export type PropertyRecomputeStatus = "idle" | "recomputing" | "ready" | "error";
export type ConversationStage =
  | "collecting_review"
  | "facet_followup"
  | "awaiting_confirmation"
  | "complete";
export type ReviewReadinessReason =
  | "greeting_or_small_talk"
  | "too_short"
  | "lacks_stay_details"
  | "needs_specifics";
export type AspectRatings = {
  service?: number;
  cleanliness?: number;
  amenities?: number;
  value?: number;
};
export type TripType = "business" | "couple" | "family" | "solo" | "friends" | "other";
export type StayLengthBucket = "1_night" | "2_3_nights" | "4_plus_nights";
export type ArrivalTimeBucket = "morning" | "afternoon" | "evening" | "late_night";
export type FactPolarity = SessionSentiment;
export type FactSeverity = "low" | "medium" | "high";
export type EvidenceMix = "vendor" | "first_party" | "blended" | "none";
export type RankerSource = "heuristic" | "learned_linear" | "learned_tree";

export interface TripContext {
  tripType?: TripType;
  stayLengthBucket?: StayLengthBucket;
  arrivalTimeBucket?: ArrivalTimeBucket;
  roomType?: string;
}

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
  vendorReviewCount?: number;
  firstPartyReviewCount?: number;
  liveReviewCount?: number;
  lastRecomputedAt?: string;
  recomputeStatus?: PropertyRecomputeStatus;
  recomputeSourceVersion?: number;
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
  sampleSize?: number;
  vendorSampleSize?: number;
  firstPartySampleSize?: number;
  sampleConfidence?: number;
  evidenceMix?: EvidenceMix;
  topDriver?: string;
}

export interface PropertyFacetEvidence {
  propertyId: string;
  facet: RuntimeFacet;
  sourceType:
    | "validated_conflict"
    | "listing_summary"
    | "demo_scenario"
    | "expedia_listing"
    | "expedia_review"
    | "first_party_review";
  snippet: string;
  acquisitionDate?: string;
  evidenceScore?: number;
}

export interface LiveReviewSample {
  propertyId: string;
  sourceVendor: PropertySourceVendor;
  sourceUrl?: string;
  reviewIdHash: string;
  headline?: string;
  text: string;
  rating?: number;
  reviewDate?: string;
  reviewerType?: string;
  tokenIdentifier?: string;
  sessionId?: string;
  fetchedAt: string;
}

export interface UserPropertyReview {
  id: string;
  propertyId: string;
  tokenIdentifier: string;
  sessionId: string;
  reviewText: string;
  overallRating?: number;
  aspectRatings?: AspectRatings;
  sentiment: SessionSentiment;
  answerCount: number;
  factCount: number;
  tripContext?: TripContext;
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
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
  vendorReviewCountSampled: number;
  vendorSupportSnippetCount: number;
  firstPartyReviewCountSampled: number;
  firstPartySupportSnippetCount: number;
  sampleConfidence: number;
  weightedSupportRate: number;
  evidenceMix: EvidenceMix;
  topDriver: string;
  fetchedAt: string;
}

export interface PropertyValidationState {
  propertyId: string;
  sourceVendor?: PropertySourceVendor;
  sourceUrl?: string;
  lastValidatedAt?: string;
  validationStatus: PropertyValidationStatus;
  vendorReviewCount?: number;
  firstPartyReviewCount?: number;
  liveReviewCount: number;
  lastRecomputedAt?: string;
  recomputeStatus?: PropertyRecomputeStatus;
  recomputeSourceVersion?: number;
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
  rankerSource?: RankerSource;
  baseModelVersion?: string;
  baseScore?: number;
  sessionAdjustment?: number;
  finalScore?: number;
  heuristicScore?: number;
  sampleSize?: number;
  evidenceMix?: EvidenceMix;
  topDriver?: string;
}

export interface LearnedRankerFeatureStats {
  mean: number;
  std: number;
}

export interface LearnedLinearRankerArtifact {
  artifactType: "learned_ranker";
  version: string;
  generatedAt: string;
  modelKind: "linear";
  featureKeys: string[];
  featureStats: LearnedRankerFeatureStats[];
  coefficients: number[];
  intercept: number;
  temporalMetrics?: Record<string, number>;
  manualMetrics?: Record<string, number>;
  notes?: string[];
}

export interface LearnedTreeRankerArtifact {
  artifactType: "learned_ranker";
  version: string;
  generatedAt: string;
  modelKind: "tree";
  featureKeys: string[];
  temporalMetrics?: Record<string, number>;
  manualMetrics?: Record<string, number>;
  treePayloadJson: string;
  notes?: string[];
}

export type LearnedRankerArtifact =
  | LearnedLinearRankerArtifact
  | LearnedTreeRankerArtifact;

export interface RankerShadowEvent {
  id: string;
  sessionId: string;
  propertyId: string;
  draftReviewHash: string;
  heuristicTop3: RuntimeFacet[];
  learnedTop3: RuntimeFacet[];
  servedTop3: RuntimeFacet[];
  finalServedFacet: RuntimeFacet | null;
  rankerSource: RankerSource;
  baseModelVersion?: string;
  disagreed: boolean;
  createdAt: string;
}

export interface ReviewAnalysisResult {
  mentionedFacets: RuntimeFacet[];
  likelyKnownFacets: RuntimeFacet[];
  sentiment: SessionSentiment;
  reviewReady: boolean;
  readinessReason: ReviewReadinessReason | null;
  suggestedClarifierPrompt: string | null;
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
  firsthandConfidence?: number;
  polarity?: FactPolarity;
  severity?: FactSeverity;
  resolved?: boolean;
  sourceSnippet?: string;
}

export interface PropertyCardDelta {
  summary: string;
  addedFacts: StructuredFact[];
}

export interface FactCandidate extends StructuredFact {
  id: string;
  source: "draft_review" | "follow_up_answer";
  sourceText: string;
  editable: boolean;
  selectedByDefault: boolean;
}

export interface EditedFactInput {
  id: string;
  value: string | number | boolean;
}

export interface ScoreProvenanceSummary {
  topFacet?: RuntimeFacet;
  summary: string;
  sampleSize: number;
  evidenceMix: EvidenceMix;
  topDriver: string;
}

type SelectNextQuestionBase = {
  assistantText: string;
  analysis: ReviewAnalysisResult;
  noFollowUp: boolean;
};

export type SelectNextQuestionResult =
  | (SelectNextQuestionBase & {
      turnType: "clarify_review";
      readinessReason: ReviewReadinessReason;
      facet: null;
      questionText: null;
      voiceText: null;
      whyThisQuestion: string;
      scoreBreakdown: null;
      supportingEvidence: [];
      questionSource: SourceDiagnostics | null;
      noFollowUp: false;
    })
  | (SelectNextQuestionBase & {
      turnType: "facet_followup";
      readinessReason: null;
      facet: RuntimeFacet;
      questionText: string;
      voiceText: string;
      whyThisQuestion: string;
      scoreBreakdown: ScoreBreakdown;
      supportingEvidence: PropertyFacetEvidence[];
      questionSource: SourceDiagnostics;
      noFollowUp: false;
    })
  | (SelectNextQuestionBase & {
      turnType: "no_follow_up";
      readinessReason: null;
      facet: null;
      questionText: null;
      voiceText: null;
      whyThisQuestion: string;
      scoreBreakdown: null;
      supportingEvidence: [];
      questionSource: null;
      noFollowUp: true;
    });

export interface SubmitFollowUpAnswerResult {
  answerRecorded: boolean;
  answerCount: number;
}

export interface FinalizeReviewPreviewResult {
  reviewText: string;
  factCandidates: FactCandidate[];
  tripContext?: TripContext;
  overallRating?: number;
  aspectRatings?: AspectRatings;
  usedOpenAI: boolean;
  usedFallback: boolean;
  confirmationPrompt: string;
}

export interface StoredReviewSession {
  id: string;
  propertyId: string;
  tokenIdentifier?: string;
  draftReview: string;
  conversationStage: ConversationStage;
  clarifierCount: number;
  overallRating?: number;
  aspectRatings?: AspectRatings;
  selectedFacet: RuntimeFacet | null;
  mentionedFacets: RuntimeFacet[];
  likelyKnownFacets: RuntimeFacet[];
  mlMentionProbByFacet: Partial<Record<RuntimeFacet, number>>;
  mlLikelyKnownByFacet: Partial<Record<RuntimeFacet, number>>;
  usedML: boolean;
  usedOpenAI: boolean;
  usedFallback: boolean;
  sentiment: SessionSentiment;
  tripContext?: TripContext;
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
  tokenIdentifier?: string;
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

export interface FinalizeReviewPreviewInput {
  sessionId: string;
  draftReview: string;
  revisionNotes?: string[];
}

export interface UpdateStructuredReviewInput {
  sessionId: string;
  overallRating: number;
  aspectRatings?: AspectRatings;
}

export interface ConfirmEnhancedReviewInput {
  sessionId: string;
  finalReviewText: string;
  factCandidates: FactCandidate[];
  confirmedFactIds: string[];
  editedFacts?: EditedFactInput[];
}

export interface SessionSummary {
  draftReview: string;
  selectedFacet: RuntimeFacet | null;
  askedQuestion: StoredFollowUpQuestion | null;
  answer: StoredFollowUpAnswer | null;
  extractedFacts: StructuredFact[];
  accumulatedEvidenceUpdates: PropertyEvidenceUpdate[];
}
