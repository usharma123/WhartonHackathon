export const DEFAULT_REVIEW_CONFIRMATION_PROMPT =
  "Review the captured facts below, uncheck anything inaccurate, edit what needs fixing, then submit the review.";

type PrimitiveFactValue = string | number | boolean;

export type ReviewPreviewFactCandidate = {
  id: string;
  facet: string;
  factType: string;
  value: PrimitiveFactValue;
  confidence: number;
  source: "draft_review" | "follow_up_answer";
  sourceText: string;
  editable: boolean;
  selectedByDefault: boolean;
  firsthandConfidence?: number;
  polarity?: string;
  severity?: string;
  resolved?: boolean;
  sourceSnippet?: string;
};

export type ReviewPreviewTripContext = {
  tripType?: string;
  stayLengthBucket?: string;
  arrivalTimeBucket?: string;
  roomType?: string;
};

export type ReviewPreviewPayload = {
  reviewText: string;
  factCandidates: ReviewPreviewFactCandidate[];
  tripContext?: ReviewPreviewTripContext | null;
  overallRating?: number;
  aspectRatings?: {
    service?: number;
    cleanliness?: number;
    amenities?: number;
    value?: number;
  };
  usedOpenAI?: boolean;
  usedFallback?: boolean;
  confirmationPrompt: string;
};

export function normalizeReviewPreviewPayload(
  value: unknown,
  fallback?: {
    draftReview?: string;
    answers?: string[];
    overallRating?: number | null;
  },
): ReviewPreviewPayload | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const reviewText =
    typeof candidate?.reviewText === "string" && candidate.reviewText.trim().length > 0
      ? candidate.reviewText.trim()
      : buildFallbackReviewText(fallback);

  if (!reviewText) {
    return null;
  }

  const rawAspectRatings = candidate?.aspectRatings;
  const rawConfirmationPrompt = candidate?.confirmationPrompt;
  const aspectRatings = isAspectRatings(rawAspectRatings) ? rawAspectRatings : undefined;
  const confirmationPrompt =
    typeof rawConfirmationPrompt === "string" && rawConfirmationPrompt.trim().length > 0
      ? rawConfirmationPrompt
      : DEFAULT_REVIEW_CONFIRMATION_PROMPT;

  return {
    reviewText,
    factCandidates: normalizeFactCandidates(candidate?.factCandidates),
    ...(isTripContext(candidate?.tripContext) ? { tripContext: candidate.tripContext } : {}),
    ...(typeof candidate?.overallRating === "number" ? { overallRating: candidate.overallRating } : {}),
    ...(aspectRatings ? { aspectRatings } : {}),
    ...(typeof candidate?.usedOpenAI === "boolean" ? { usedOpenAI: candidate.usedOpenAI } : {}),
    ...(typeof candidate?.usedFallback === "boolean" ? { usedFallback: candidate.usedFallback } : {}),
    confirmationPrompt,
  };
}

function normalizeFactCandidates(value: unknown): ReviewPreviewFactCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.facet !== "string" ||
      typeof candidate.factType !== "string" ||
      !isPrimitiveFactValue(candidate.value) ||
      typeof candidate.sourceText !== "string"
    ) {
      return [];
    }

    return [
      {
        id:
          typeof candidate.id === "string" && candidate.id.length > 0
            ? candidate.id
            : `preview_fact_${index}`,
        facet: candidate.facet,
        factType: candidate.factType,
        value: candidate.value,
        confidence: typeof candidate.confidence === "number" ? candidate.confidence : 0.5,
        source: candidate.source === "follow_up_answer" ? "follow_up_answer" : "draft_review",
        sourceText: candidate.sourceText,
        editable: candidate.editable !== false,
        selectedByDefault: candidate.selectedByDefault !== false,
        ...(typeof candidate.firsthandConfidence === "number"
          ? { firsthandConfidence: candidate.firsthandConfidence }
          : {}),
        ...(typeof candidate.polarity === "string" ? { polarity: candidate.polarity } : {}),
        ...(typeof candidate.severity === "string" ? { severity: candidate.severity } : {}),
        ...(typeof candidate.resolved === "boolean" ? { resolved: candidate.resolved } : {}),
        ...(typeof candidate.sourceSnippet === "string" ? { sourceSnippet: candidate.sourceSnippet } : {}),
      },
    ];
  });
}

function buildFallbackReviewText(fallback?: {
  draftReview?: string;
  answers?: string[];
  overallRating?: number | null;
}): string | null {
  const parts = [fallback?.draftReview?.trim(), ...(fallback?.answers ?? []).map((answer) => answer.trim())]
    .filter((part): part is string => Boolean(part && part.length > 0));

  if (parts.length === 0) {
    return null;
  }

  return appendOverallRatingIfMissing(parts.join(" "), fallback?.overallRating ?? undefined);
}

function appendOverallRatingIfMissing(reviewText: string, overallRating?: number): string {
  const normalized = ensureSentenceEnd(reviewText.trim());
  if (!normalized || typeof overallRating !== "number") {
    return normalized;
  }
  if (
    new RegExp(`\\b${overallRating}\\s*/\\s*10\\b`, "i").test(normalized) ||
    new RegExp(`\\b${overallRating}\\s+out of\\s+10\\b`, "i").test(normalized)
  ) {
    return normalized;
  }
  return `${normalized} I'd rate this stay ${overallRating} out of 10.`;
}

function ensureSentenceEnd(text: string): string {
  if (!text) {
    return text;
  }
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function isPrimitiveFactValue(value: unknown): value is PrimitiveFactValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isTripContext(value: unknown): value is ReviewPreviewTripContext {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return ["tripType", "stayLengthBucket", "arrivalTimeBucket", "roomType"].every(
    (key) => candidate[key] === undefined || typeof candidate[key] === "string",
  );
}

function isAspectRatings(
  value: unknown,
): value is ReviewPreviewPayload["aspectRatings"] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return ["service", "cleanliness", "amenities", "value"].every(
    (key) => candidate[key] === undefined || typeof candidate[key] === "number",
  );
}
