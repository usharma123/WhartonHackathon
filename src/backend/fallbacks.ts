import { FACET_POLICIES, facetLabel, type RuntimeFacet } from "./facets.js";
import type {
  AspectRatings,
  ReviewReadinessReason,
  PropertyRecord,
  ReviewAnalysisResult,
  SessionSentiment,
  StructuredFact,
} from "./types.js";

const POSITIVE_CUES = [
  "great",
  "good",
  "smooth",
  "easy",
  "friendly",
  "open",
  "available",
  "clean",
  "fast",
  "helpful",
];

const NEGATIVE_CUES = [
  "bad",
  "terrible",
  "slow",
  "closed",
  "broken",
  "rude",
  "dirty",
  "fee",
  "charge",
  "wait",
  "problem",
  "difficult",
  "noisy",
  "unexpected",
];

const GREETING_ONLY_PATTERN =
  /^(?:hi|hello|hey|yo|howdy|hi there|hello there|good morning|good afternoon|good evening|sup|what'?s up)[!. ]*$/i;
const EXPERIENCE_TERMS = [
  "room",
  "staff",
  "desk",
  "service",
  "food",
  "breakfast",
  "parking",
  "pool",
  "check-in",
  "check in",
  "checkout",
  "check-out",
  "hotel",
  "stay",
  "bed",
  "bathroom",
  "noise",
  "fee",
  "charge",
  "clean",
  "dirty",
  "rude",
  "friendly",
  "wait",
  "waiting",
  "arrived",
  "arrival",
  "stayed",
  "late",
  "early",
];

export function analyzeReviewReadiness(args: {
  draftReview: string;
  eligibleFacets: RuntimeFacet[];
  mentionedFacets: RuntimeFacet[];
}): {
  reviewReady: boolean;
  readinessReason: ReviewReadinessReason | null;
} {
  const text = args.draftReview.trim();
  const lower = text.toLowerCase();
  const words = lower.match(/\b[\w'-]+\b/g) ?? [];
  const wordCount = words.length;
  const hasGreetingOnly = GREETING_ONLY_PATTERN.test(text);
  const hasExperienceTerms = EXPERIENCE_TERMS.some((term) => lower.includes(term));
  const concreteSignals =
    args.mentionedFacets.length > 0 ||
    /\b\d{1,3}\b/.test(lower) ||
    /\$\s?\d/.test(lower) ||
    /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i.test(lower) ||
    /\b(because|when|after|before|during|until|but|and)\b/.test(lower);

  if (hasGreetingOnly) {
    return { reviewReady: false, readinessReason: "greeting_or_small_talk" };
  }
  if (wordCount < 4) {
    return { reviewReady: false, readinessReason: "too_short" };
  }
  if (!hasExperienceTerms && args.mentionedFacets.length === 0) {
    return { reviewReady: false, readinessReason: "lacks_stay_details" };
  }
  if (wordCount < 7 || !concreteSignals) {
    return { reviewReady: false, readinessReason: "needs_specifics" };
  }
  return { reviewReady: true, readinessReason: null };
}

export function generateClarifierFallback(args: {
  draftReview: string;
  property: PropertyRecord;
  readinessReason: ReviewReadinessReason;
}): string {
  const draft = args.draftReview.trim().toLowerCase();
  switch (args.readinessReason) {
    case "greeting_or_small_talk":
      return "Tell me a bit about your stay in your own words, and include one or two things that stood out.";
    case "too_short":
      return "Give me one or two specific details from the stay so I can turn this into a real review.";
    case "lacks_stay_details":
      return "What actually stood out during the stay, like the room, service, or anything that shaped your impression?";
    case "needs_specifics":
      if (draft.includes("service")) {
        return "What specifically about the service stood out to you?";
      }
      if (draft.includes("amenities")) {
        return "Which amenity did you actually use, and how was it in practice?";
      }
      return "That helps. Can you add one or two specifics about what happened?";
    default:
      return "Tell me a bit more about what happened during the stay.";
  }
}

export function fixedClarifierPrompt(): string {
  return "Give me 1 or 2 specific details from the stay, like the room, staff, food, check-in, or parking.";
}

export function analyzeReviewFallback(args: {
  draftReview: string;
  eligibleFacets: RuntimeFacet[];
}): ReviewAnalysisResult {
  const text = args.draftReview.toLowerCase();
  const mentionedFacets = args.eligibleFacets.filter((facet) =>
    FACET_POLICIES[facet].reviewPatterns.some((pattern) => pattern.test(text)),
  );

  const likelyKnownFacets = mentionedFacets.filter((facet) =>
    /\b(i|we|my|our)\b/i.test(text) ||
    /\bwas\b|\bwere\b|\bhad\b|\bgot\b|\bused\b/i.test(text),
  );
  const readiness = analyzeReviewReadiness({
    draftReview: args.draftReview,
    eligibleFacets: args.eligibleFacets,
    mentionedFacets,
  });

  return {
    mentionedFacets,
    likelyKnownFacets,
    sentiment: detectSentiment(text),
    reviewReady: readiness.reviewReady,
    readinessReason: readiness.readinessReason,
    suggestedClarifierPrompt: readiness.readinessReason
      ? generateClarifierFallback({
          draftReview: args.draftReview,
          property: { propertyId: "unknown", propertySummary: "", facetListingTexts: {}, demoFlags: [] },
          readinessReason: readiness.readinessReason,
        })
      : null,
    mlMentionProbByFacet: {},
    mlLikelyKnownByFacet: {},
    usedML: false,
    usedOpenAI: false,
    usedFallback: true,
  };
}

export function generateQuestionFallback(args: {
  facet: RuntimeFacet;
  property: PropertyRecord;
}): { questionText: string; voiceText: string } {
  const policy = FACET_POLICIES[args.facet];
  return {
    questionText: policy.questionTemplate,
    voiceText: policy.voiceTemplate,
  };
}

export function extractAnswerFactsFallback(args: {
  facet: RuntimeFacet;
  answerText: string;
}): { structuredFacts: StructuredFact[]; confidence: number } {
  const text = args.answerText.trim();
  const lower = text.toLowerCase();
  if (isUnknownAnswer(lower)) {
    return {
      structuredFacts: [],
      confidence: 0.2,
    };
  }
  const facts: StructuredFact[] = [];

  switch (args.facet) {
    case "check_in": {
      addBooleanFact(
        facts,
        args.facet,
        "smooth",
        lower,
        ["smooth", "easy", "quick"],
        ["wait", "line", "not ready", "issue", "problem", "delay"],
      );
      addNumberFact(facts, args.facet, "wait_minutes", lower);
      addTimeFact(facts, args.facet, "observed_time", lower);
      break;
    }
    case "check_out": {
      addBooleanFact(
        facts,
        args.facet,
        "smooth",
        lower,
        ["easy", "fast", "simple", "smooth"],
        ["charge", "fee", "problem", "line", "delay"],
      );
      addBooleanFact(
        facts,
        args.facet,
        "late_checkout_available",
        lower,
        ["late checkout", "extended checkout", "allowed late"],
        ["no late checkout", "denied late checkout"],
      );
      addTimeFact(facts, args.facet, "observed_time", lower);
      break;
    }
    case "amenities_breakfast": {
      addBooleanFact(
        facts,
        args.facet,
        "available",
        lower,
        ["breakfast was available", "buffet was open", "had breakfast", "breakfast was good"],
        ["no breakfast", "nothing ready", "breakfast was closed", "ran out"],
      );
      addBooleanFact(
        facts,
        args.facet,
        "worth_it",
        lower,
        ["worth it", "good", "great", "solid", "fresh"],
        ["not worth", "bad", "terrible", "limited", "empty"],
      );
      addMoneyFact(facts, args.facet, "breakfast_fee", lower);
      break;
    }
    case "amenities_parking": {
      addBooleanFact(
        facts,
        args.facet,
        "available",
        lower,
        ["easy to park", "plenty of parking", "free parking", "available"],
        ["no parking", "not enough parking", "parking was a problem", "full", "tight"],
      );
      addBooleanFact(
        facts,
        args.facet,
        "easy_access",
        lower,
        ["easy", "simple", "convenient"],
        ["tight", "difficult", "hard", "small", "problem"],
      );
      addMoneyFact(facts, args.facet, "parking_fee", lower);
      break;
    }
    case "know_before_you_go": {
      addBooleanFact(
        facts,
        args.facet,
        "unexpected_fee_reported",
        lower,
        ["unexpected fee", "extra charge", "deposit", "fee"],
        ["no extra fees", "no surprise fees"],
      );
      addBooleanFact(
        facts,
        args.facet,
        "noise_or_construction_reported",
        lower,
        ["construction", "renovation", "noise", "noisy", "loud"],
        ["quiet", "no noise issues"],
      );
      break;
    }
    case "amenities_pool": {
      addBooleanFact(
        facts,
        args.facet,
        "open",
        lower,
        ["pool was open", "open", "usable"],
        ["pool was closed", "closed", "unusable"],
      );
      addTimeFact(facts, args.facet, "pool_hours", lower);
      break;
    }
    default:
      break;
  }

  if (facts.length === 0 && text.length > 0) {
    facts.push({
      facet: args.facet,
      factType: "freeform_note",
      value: text,
      confidence: 0.35,
    });
  }

  return {
    structuredFacts: dedupeFacts(facts),
    confidence: Math.min(0.85, facts.length > 0 ? 0.5 + facts.length * 0.08 : 0.3),
  };
}

export function propertyCardDeltaSummary(
  facet: RuntimeFacet,
  facts: StructuredFact[],
): string {
  if (facts.length === 0) {
    return `No conservative ${facetLabel(facet)} facts were extracted from the answer.`;
  }
  return `Captured ${facts.length} ${facetLabel(facet)} fact${
    facts.length === 1 ? "" : "s"
  } for append-only evidence updates.`;
}

export function generateEnhancedReviewFallback(args: {
  draftReview: string;
  answers: Array<{ facet: RuntimeFacet; answerText: string }>;
  structuredFacts: StructuredFact[];
  overallRating?: number;
  aspectRatings?: AspectRatings;
  revisionNotes?: string[];
}): string {
  const parts = [
    args.draftReview.trim(),
    ...args.answers.map((answer) => answer.answerText.trim()),
    ...(args.revisionNotes ?? []).map((note) => note.trim()),
  ].filter(Boolean);

  if (parts.length === 0) {
    return "I wanted to share a quick review of my stay.";
  }

  const normalized = parts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return appendOverallRatingIfMissing(normalized, args.overallRating);
}

export function appendOverallRatingIfMissing(
  reviewText: string,
  overallRating?: number,
): string {
  const normalized = reviewText.trim();
  if (!normalized) {
    return normalized;
  }
  if (typeof overallRating !== "number") {
    return ensureSentenceEnd(normalized);
  }
  if (mentionsOverallRating(normalized, overallRating)) {
    return ensureSentenceEnd(normalized);
  }
  return `${ensureSentenceEnd(normalized)} Overall, I’d rate this stay ${overallRating} out of 10.`;
}

function ensureSentenceEnd(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function mentionsOverallRating(text: string, overallRating: number): boolean {
  const patterns = [
    new RegExp(`\\b${overallRating}\\s*/\\s*10\\b`, "i"),
    new RegExp(`\\b${overallRating}\\s+out of\\s+10\\b`, "i"),
    new RegExp(`\\boverall\\b[^.?!]*\\b${overallRating}\\b`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function isUnknownAnswer(text: string): boolean {
  return /^(i do not know|i don't know|dont know|don't know|not sure|unsure|no idea|unknown|n\/a)$/i.test(
    text.trim(),
  );
}

function detectSentiment(text: string): SessionSentiment {
  const positive = POSITIVE_CUES.filter((cue) => text.includes(cue)).length;
  const negative = NEGATIVE_CUES.filter((cue) => text.includes(cue)).length;
  if (positive > 0 && negative > 0) {
    return "mixed";
  }
  if (negative > 0) {
    return "negative";
  }
  if (positive > 0) {
    return "positive";
  }
  return "neutral";
}

function addBooleanFact(
  facts: StructuredFact[],
  facet: RuntimeFacet,
  factType: string,
  text: string,
  positiveSignals: string[],
  negativeSignals: string[],
): void {
  const positive = positiveSignals.some((signal) => text.includes(signal));
  const negative = negativeSignals.some((signal) => text.includes(signal));
  if (!positive && !negative) {
    return;
  }
  facts.push({
    facet,
    factType,
    value: positive && !negative,
    confidence: 0.62,
  });
}

function addNumberFact(
  facts: StructuredFact[],
  facet: RuntimeFacet,
  factType: string,
  text: string,
): void {
  const match = text.match(/\b(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/);
  if (!match) {
    return;
  }
  const value = Number.parseInt(match[1], 10);
  const unit = match[2].startsWith("hour") || match[2].startsWith("hr") ? 60 : 1;
  facts.push({
    facet,
    factType,
    value: value * unit,
    confidence: 0.7,
  });
}

function addTimeFact(
  facts: StructuredFact[],
  facet: RuntimeFacet,
  factType: string,
  text: string,
): void {
  const match = text.match(/\b(\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/);
  if (!match) {
    return;
  }
  facts.push({
    facet,
    factType,
    value: match[1].replace(/\s+/g, ""),
    confidence: 0.74,
  });
}

function addMoneyFact(
  facts: StructuredFact[],
  facet: RuntimeFacet,
  factType: string,
  text: string,
): void {
  const match = text.match(/\$ ?(\d+(?:\.\d{2})?)/);
  if (!match) {
    return;
  }
  facts.push({
    facet,
    factType,
    value: Number.parseFloat(match[1]),
    confidence: 0.72,
  });
}

function dedupeFacts(facts: StructuredFact[]): StructuredFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.facet}:${fact.factType}:${String(fact.value)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
