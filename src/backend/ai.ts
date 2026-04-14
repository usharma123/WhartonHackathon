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
  StructuredFact,
} from "./types.js";

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
  },
): Promise<ReviewAnalysisResult> {
  const fallback = analyzeReviewFallback({
    draftReview: input.draftReview,
    eligibleFacets: input.eligibleFacets,
  });
  if (!client) {
    return fallback;
  }
  try {
    const result = await client.analyzeReview(input);
    return {
      mentionedFacets: dedupeFacetList(
        result.mentionedFacets.filter((facet) => input.eligibleFacets.includes(facet)),
      ),
      likelyKnownFacets: dedupeFacetList(
        result.likelyKnownFacets.filter((facet) => input.eligibleFacets.includes(facet)),
      ),
      sentiment: result.sentiment,
      usedFallback: false,
    };
  } catch {
    return fallback;
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
      structuredFacts: result.structuredFacts,
      confidence: result.confidence,
      usedFallback: false,
    };
  } catch {
    const fallback = extractAnswerFactsFallback(input);
    return { ...fallback, usedFallback: true };
  }
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
