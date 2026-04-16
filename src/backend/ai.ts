import OpenAI from "openai";

import type { RuntimeFacet } from "./facets.js";
import {
  analyzeReviewReadiness,
  analyzeReviewFallback,
  appendOverallRatingIfMissing,
  extractAnswerFactsFallback,
  fixedClarifierPrompt,
  generateClarifierFallback,
  generateEnhancedReviewFallback,
  generateQuestionFallback,
} from "./fallbacks.js";
import type {
  AspectRatings,
  FinalizeReviewPreviewResult,
  PropertyFacetEvidence,
  PropertyRecord,
  ReviewReadinessReason,
  ReviewAnalysisResult,
  SourceDiagnostics,
  StructuredFact,
} from "./types.js";
import type { FacetClassifierArtifact } from "./ml.js";
import { predictFacetMentions } from "./ml.js";

export interface ReviewGapAIClient {
  analyzeReview(input: {
    draftReview: string;
    eligibleFacets: RuntimeFacet[];
    property: PropertyRecord;
  }): Promise<Omit<ReviewAnalysisResult, "usedFallback">>;
  generateQuestion(input: {
    facet: RuntimeFacet;
    property: PropertyRecord;
    supportingEvidence: PropertyFacetEvidence[];
    draftReview: string;
  }): Promise<{ questionText: string; voiceText: string }>;
  generateClarifier(input: {
    draftReview: string;
    property: PropertyRecord;
    readinessReason: ReviewReadinessReason;
  }): Promise<{ assistantText: string }>;
  extractAnswerFacts(input: {
    facet: RuntimeFacet;
    property: PropertyRecord;
    answerText: string;
  }): Promise<{ structuredFacts: StructuredFact[]; confidence: number }>;
  generateEnhancedReview(input: {
    draftReview: string;
    answers: Array<{ facet: RuntimeFacet; answerText: string }>;
    structuredFacts: StructuredFact[];
    overallRating?: number;
    aspectRatings?: AspectRatings;
    revisionNotes?: string[];
  }): Promise<{ reviewText: string }>;
}

export async function analyzeReviewWithFallback(
  client: ReviewGapAIClient | undefined,
  input: {
    draftReview: string;
    eligibleFacets: RuntimeFacet[];
    property: PropertyRecord;
    classifierArtifact?: FacetClassifierArtifact;
  },
): Promise<ReviewAnalysisResult> {
  const fallback = analyzeReviewFallback({
    draftReview: input.draftReview,
    eligibleFacets: input.eligibleFacets,
  });
  const mlPrediction = input.classifierArtifact
    ? predictFacetMentions(input.classifierArtifact, input.draftReview)
    : null;
  const mlMentionProbByFacet = filterProbabilities(
    mlPrediction?.mentionProbabilities ?? {},
    input.eligibleFacets,
  );
  const mlLikelyKnownByFacet = filterProbabilities(
    mlPrediction?.likelyKnownProbabilities ?? {},
    input.eligibleFacets,
  );
  const mlMentioned = mlPrediction
    ? mlPrediction.mentionedFacets.filter((facet) => input.eligibleFacets.includes(facet))
    : [];
  const mlLikelyKnown = mlPrediction
    ? mlPrediction.likelyKnownFacets.filter((facet) => input.eligibleFacets.includes(facet))
    : [];
  const readiness = analyzeReviewReadiness({
    draftReview: input.draftReview,
    eligibleFacets: input.eligibleFacets,
    mentionedFacets: mlMentioned.length > 0 ? mlMentioned : fallback.mentionedFacets,
  });
  if (!client) {
    return {
      ...fallback,
      mentionedFacets: mlMentioned.length > 0 ? mlMentioned : fallback.mentionedFacets,
      likelyKnownFacets: mlLikelyKnown.length > 0 ? mlLikelyKnown : fallback.likelyKnownFacets,
      reviewReady: readiness.reviewReady,
      readinessReason: readiness.readinessReason,
      suggestedClarifierPrompt: readiness.readinessReason
        ? generateClarifierFallback({
            draftReview: input.draftReview,
            property: input.property,
            readinessReason: readiness.readinessReason,
          })
        : null,
      mlMentionProbByFacet,
      mlLikelyKnownByFacet,
      usedML: Boolean(mlPrediction),
    };
  }
  try {
    const result = normalizeReviewAnalysisPayload(
      await client.analyzeReview({
        draftReview: input.draftReview,
        eligibleFacets: input.eligibleFacets,
        property: input.property,
      }),
      input.eligibleFacets,
    );
    return {
      mentionedFacets:
        mlMentioned.length > 0
          ? dedupeFacetList(mlMentioned)
          : result.mentionedFacets,
      likelyKnownFacets:
        mlLikelyKnown.length > 0
          ? dedupeFacetList(mlLikelyKnown)
          : result.likelyKnownFacets,
      sentiment: result.sentiment,
      reviewReady: readiness.reviewReady,
      readinessReason: readiness.readinessReason,
      suggestedClarifierPrompt: readiness.readinessReason
        ? generateClarifierFallback({
            draftReview: input.draftReview,
            property: input.property,
            readinessReason: readiness.readinessReason,
          })
        : null,
      mlMentionProbByFacet,
      mlLikelyKnownByFacet,
      usedML: Boolean(mlPrediction),
      usedOpenAI: true,
      usedFallback: false,
    };
  } catch {
    return {
      ...fallback,
      mentionedFacets: mlMentioned.length > 0 ? mlMentioned : fallback.mentionedFacets,
      likelyKnownFacets: mlLikelyKnown.length > 0 ? mlLikelyKnown : fallback.likelyKnownFacets,
      reviewReady: readiness.reviewReady,
      readinessReason: readiness.readinessReason,
      suggestedClarifierPrompt: readiness.readinessReason
        ? generateClarifierFallback({
            draftReview: input.draftReview,
            property: input.property,
            readinessReason: readiness.readinessReason,
          })
        : null,
      mlMentionProbByFacet,
      mlLikelyKnownByFacet,
      usedML: Boolean(mlPrediction),
    };
  }
}

export async function generateQuestionWithFallback(
  client: ReviewGapAIClient | undefined,
  input: {
    facet: RuntimeFacet;
    property: PropertyRecord;
    supportingEvidence: PropertyFacetEvidence[];
    draftReview: string;
  },
): Promise<{ questionText: string; voiceText: string; usedFallback: boolean }> {
  if (!client) {
    const fallback = generateQuestionFallback(input);
    return { ...fallback, usedFallback: true };
  }
  try {
    const result = await client.generateQuestion(input);
    return { ...result, usedFallback: false };
  } catch {
    const fallback = generateQuestionFallback(input);
    return { ...fallback, usedFallback: true };
  }
}

export async function generateClarifierWithFallback(
  client: ReviewGapAIClient | undefined,
  input: {
    draftReview: string;
    property: PropertyRecord;
    readinessReason: ReviewReadinessReason;
    useFixedPrompt?: boolean;
  },
): Promise<{ assistantText: string; usedFallback: boolean }> {
  if (input.useFixedPrompt) {
    return { assistantText: fixedClarifierPrompt(), usedFallback: true };
  }
  if (!client) {
    return {
      assistantText: generateClarifierFallback(input),
      usedFallback: true,
    };
  }
  try {
    const result = await client.generateClarifier(input);
    return {
      assistantText:
        typeof result.assistantText === "string" && result.assistantText.trim().length > 0
          ? result.assistantText.trim()
          : generateClarifierFallback(input),
      usedFallback: false,
    };
  } catch {
    return {
      assistantText: generateClarifierFallback(input),
      usedFallback: true,
    };
  }
}

export async function extractAnswerFactsWithFallback(
  client: ReviewGapAIClient | undefined,
  input: {
    facet: RuntimeFacet;
    property: PropertyRecord;
    answerText: string;
  },
): Promise<{ structuredFacts: StructuredFact[]; confidence: number; usedFallback: boolean }> {
  if (!client) {
    const fallback = extractAnswerFactsFallback(input);
    return { ...fallback, usedFallback: true };
  }
  try {
    const result = await client.extractAnswerFacts(input);
    return {
      structuredFacts: normalizeStructuredFacts(result.structuredFacts, input.facet),
      confidence: clampConfidence(result.confidence),
      usedFallback: false,
    };
  } catch {
    const fallback = extractAnswerFactsFallback(input);
    return { ...fallback, usedFallback: true };
  }
}

export async function generateEnhancedReviewWithFallback(
  client: ReviewGapAIClient | undefined,
  input: {
    draftReview: string;
    answers: Array<{ facet: RuntimeFacet; answerText: string }>;
    structuredFacts: StructuredFact[];
    overallRating?: number;
    aspectRatings?: AspectRatings;
    revisionNotes?: string[];
  },
): Promise<Pick<FinalizeReviewPreviewResult, "reviewText" | "usedOpenAI" | "usedFallback">> {
  if (!client) {
    return {
      reviewText: generateEnhancedReviewFallback(input),
      usedOpenAI: false,
      usedFallback: true,
    };
  }
  try {
    const result = await client.generateEnhancedReview(input);
    return {
      reviewText: appendOverallRatingIfMissing(
        typeof result.reviewText === "string" && result.reviewText.trim().length > 0
          ? result.reviewText.trim()
          : generateEnhancedReviewFallback(input),
        input.overallRating,
      ),
      usedOpenAI: true,
      usedFallback: false,
    };
  } catch {
    return {
      reviewText: generateEnhancedReviewFallback(input),
      usedOpenAI: false,
      usedFallback: true,
    };
  }
}

export function sourceDiagnostics(args: {
  usedOpenAI: boolean;
  usedFallback: boolean;
}): SourceDiagnostics {
  return {
    usedOpenAI: args.usedOpenAI,
    usedFallback: args.usedFallback,
  };
}

export class OpenAIReviewGapClient implements ReviewGapAIClient {
  constructor(
    private readonly openai: OpenAI,
    private readonly model = "gpt-5.4-nano",
  ) {}

  async analyzeReview(input: {
    draftReview: string;
    eligibleFacets: RuntimeFacet[];
    property: PropertyRecord;
  }): Promise<Omit<ReviewAnalysisResult, "usedFallback">> {
    return this.jsonCompletion(
      [
        "You are extracting structured review signals.",
        "Return JSON with keys mentionedFacets, likelyKnownFacets, and sentiment.",
        "Only use facets from the provided allow-list.",
        "Sentiment must be one of positive, negative, mixed, neutral.",
      ].join(" "),
      JSON.stringify(input),
    );
  }

  async generateQuestion(input: {
    facet: RuntimeFacet;
    property: PropertyRecord;
    supportingEvidence: PropertyFacetEvidence[];
    draftReview: string;
  }): Promise<{ questionText: string; voiceText: string }> {
    return this.jsonCompletion(
      [
        "You are phrasing a single follow-up question.",
        "Return JSON with questionText and voiceText.",
        "Do not change the chosen facet.",
        "Keep it short, natural, specific, and retrospective.",
        "Ask only about what the traveler personally experienced.",
        "Do not ask hypothetical or policy lookup questions.",
      ].join(" "),
      JSON.stringify(input),
    );
  }

  async generateClarifier(input: {
    draftReview: string;
    property: PropertyRecord;
    readinessReason: ReviewReadinessReason;
  }): Promise<{ assistantText: string }> {
    return this.jsonCompletion(
      [
        "You are helping a traveler turn a vague hotel review into a more substantive one.",
        "Return JSON with assistantText only.",
        "Ask for one or two specific details from the stay.",
        "Do not ask a property rules-engine question yet.",
        "Keep it conversational, short, and natural.",
      ].join(" "),
      JSON.stringify(input),
    );
  }

  async extractAnswerFacts(input: {
    facet: RuntimeFacet;
    property: PropertyRecord;
    answerText: string;
  }): Promise<{ structuredFacts: StructuredFact[]; confidence: number }> {
    return this.jsonCompletion(
      [
        "You are converting an answer into structured facts.",
        "Return JSON with structuredFacts and confidence.",
        "Each fact must include facet, factType, value, confidence.",
        "Be conservative and only emit facts supported by the answer text.",
      ].join(" "),
      JSON.stringify(input),
    );
  }

  async generateEnhancedReview(input: {
    draftReview: string;
    answers: Array<{ facet: RuntimeFacet; answerText: string }>;
    structuredFacts: StructuredFact[];
    overallRating?: number;
    aspectRatings?: AspectRatings;
    revisionNotes?: string[];
  }): Promise<{ reviewText: string }> {
    return this.jsonCompletion(
      [
        "You rewrite a hotel review into a concise, natural first-person traveler review.",
        "Return JSON with reviewText only.",
        "Preserve the user's meaning, tone, and concrete facts.",
        "Do not invent details or scores.",
        "Use only information explicitly provided in the user's draft, structured ratings, revision notes, and accepted follow-up answers.",
        "Do not pull details from the property listing, property card, or supporting evidence into the review body.",
        "Do not broaden specific details into vague summaries like 'good amenities' unless the user explicitly used that phrase.",
        "Keep it readable and publication-ready in 3 to 6 sentences.",
        "Blend positives and negatives naturally when both appear.",
      ].join(" "),
      JSON.stringify(input),
    );
  }

  private async jsonCompletion<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI did not return JSON content.");
    }
    return JSON.parse(content) as T;
  }
}

function dedupeFacetList(facets: RuntimeFacet[]): RuntimeFacet[] {
  return [...new Set(facets)];
}

function filterProbabilities(
  probabilities: Partial<Record<RuntimeFacet, number>>,
  eligibleFacets: RuntimeFacet[],
): Partial<Record<RuntimeFacet, number>> {
  return Object.fromEntries(
    Object.entries(probabilities).filter(([facet]) =>
      eligibleFacets.includes(facet as RuntimeFacet),
    ),
  ) as Partial<Record<RuntimeFacet, number>>;
}

function normalizeReviewAnalysisPayload(
  payload: Partial<ReviewAnalysisResult> | undefined,
  eligibleFacets: RuntimeFacet[],
): Pick<ReviewAnalysisResult, "mentionedFacets" | "likelyKnownFacets" | "sentiment"> {
  const mentionedFacets = dedupeFacetList(
    asFacetList(payload?.mentionedFacets).filter((facet) => eligibleFacets.includes(facet)),
  );
  const likelyKnownFacets = dedupeFacetList(
    asFacetList(payload?.likelyKnownFacets).filter((facet) => eligibleFacets.includes(facet)),
  );
  const sentiment = asSentiment(payload?.sentiment);
  return {
    mentionedFacets,
    likelyKnownFacets,
    sentiment,
  };
}

function asFacetList(value: unknown): RuntimeFacet[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((facet): facet is RuntimeFacet => typeof facet === "string");
}

function asSentiment(value: unknown): ReviewAnalysisResult["sentiment"] {
  if (
    value === "positive" ||
    value === "negative" ||
    value === "mixed" ||
    value === "neutral"
  ) {
    return value;
  }
  return "neutral";
}

function normalizeStructuredFacts(
  facts: StructuredFact[] | undefined,
  facet: RuntimeFacet,
): StructuredFact[] {
  if (!Array.isArray(facts)) {
    return [];
  }
  return facts
    .filter(
      (fact) =>
        fact &&
        typeof fact.factType === "string" &&
        fact.factType.trim().length > 0 &&
        ["string", "number", "boolean"].includes(typeof fact.value),
    )
    .map((fact) => ({
      facet,
      factType: fact.factType.trim(),
      value: fact.value,
      confidence: clampConfidence(fact.confidence),
    }));
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}
