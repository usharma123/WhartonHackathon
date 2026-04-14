import OpenAI from "openai";

import type { RuntimeFacet } from "./facets.js";
import {
  analyzeReviewFallback,
  extractAnswerFactsFallback,
  generateQuestionFallback,
} from "./fallbacks.js";
import type {
  PropertyFacetEvidence,
  PropertyRecord,
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
  extractAnswerFacts(input: {
    facet: RuntimeFacet;
    property: PropertyRecord;
    answerText: string;
  }): Promise<{ structuredFacts: StructuredFact[]; confidence: number }>;
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
  if (!client) {
    return {
      ...fallback,
      mentionedFacets: mlMentioned.length > 0 ? mlMentioned : fallback.mentionedFacets,
      likelyKnownFacets: mlLikelyKnown.length > 0 ? mlLikelyKnown : fallback.likelyKnownFacets,
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
    private readonly model = "gpt-4o-mini",
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
        "Keep it short, natural, and specific.",
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
