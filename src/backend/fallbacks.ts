import { FACET_POLICIES, facetLabel, type RuntimeFacet } from "./facets.js";
import type {
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

  return {
    mentionedFacets,
    likelyKnownFacets,
    sentiment: detectSentiment(text),
    usedFallback: true,
  };
}

export function generateQuestionFallback(args: {
  facet: RuntimeFacet;
  property: PropertyRecord;
}): { questionText: string; voiceText: string } {
  const policy = FACET_POLICIES[args.facet];
  const city = args.property.city ? ` in ${args.property.city}` : "";
  return {
    questionText: `${policy.questionTemplate}${city ? ` This helps clarify the listing${city}.` : ""}`,
    voiceText: policy.voiceTemplate,
  };
}

export function extractAnswerFactsFallback(args: {
  facet: RuntimeFacet;
  answerText: string;
}): { structuredFacts: StructuredFact[]; confidence: number } {
  const text = args.answerText.trim();
  const lower = text.toLowerCase();
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
