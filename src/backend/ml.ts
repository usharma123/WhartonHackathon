import { readFile } from "node:fs/promises";

import type { RuntimeFacet } from "./facets.js";

export const CLASSIFIER_RUNTIME_FACETS = [
  "check_in",
  "check_out",
  "amenities_breakfast",
  "amenities_parking",
  "know_before_you_go",
  "amenities_pool",
] as const satisfies readonly RuntimeFacet[];

export type ClassifierRuntimeFacet = (typeof CLASSIFIER_RUNTIME_FACETS)[number];

export interface FacetClassifierModelMetrics {
  trainingRows: number;
  validationRows: number;
  positiveRate: number;
  rocAuc: number;
  f1: number;
  precision: number;
  recall: number;
}

export interface FacetClassifierModel {
  facet: ClassifierRuntimeFacet;
  intercept: number;
  threshold: number;
  coefficients: number[];
  topPositiveTerms: string[];
  topNegativeTerms: string[];
  metrics: FacetClassifierModelMetrics;
}

export interface FacetClassifierArtifact {
  artifactType: "facet_classifier";
  version: string;
  generatedAt: string;
  tokenizer: {
    regex: string;
    minTokenLength: number;
    ngramRange: [number, number];
    lowercase: boolean;
    stripAccents: boolean;
    l2Normalize: boolean;
  };
  runtimeFacets: ClassifierRuntimeFacet[];
  vocabulary: Record<string, number>;
  terms: string[];
  idf: number[];
  models: FacetClassifierModel[];
}

export interface FacetClassifierPrediction {
  mentionProbabilities: Partial<Record<RuntimeFacet, number>>;
  likelyKnownProbabilities: Partial<Record<RuntimeFacet, number>>;
  mentionedFacets: RuntimeFacet[];
  likelyKnownFacets: RuntimeFacet[];
}

export async function loadFacetClassifierArtifact(
  artifactPath: string,
): Promise<FacetClassifierArtifact> {
  const content = await readFile(artifactPath, "utf8");
  return JSON.parse(content) as FacetClassifierArtifact;
}

export function predictFacetMentions(
  artifact: FacetClassifierArtifact,
  text: string,
): FacetClassifierPrediction {
  const tfidfVector = vectorizeText(text, artifact);
  const mentionProbabilities: Partial<Record<RuntimeFacet, number>> = {};
  const likelyKnownProbabilities: Partial<Record<RuntimeFacet, number>> = {};
  const mentionedFacets: RuntimeFacet[] = [];
  const likelyKnownFacets: RuntimeFacet[] = [];
  const firstPerson = /\b(i|we|my|our|me|us)\b/i.test(text);
  const experiential = /\b(was|were|had|got|used|tried|found|waited|paid)\b/i.test(text);
  const firsthandWeight = firstPerson || experiential ? 1 : 0.65;

  for (const model of artifact.models) {
    const probability = sigmoid(dot(tfidfVector, model.coefficients) + model.intercept);
    mentionProbabilities[model.facet] = round(probability);
    const likelyKnown = round(Math.min(1, probability * firsthandWeight));
    likelyKnownProbabilities[model.facet] = likelyKnown;
    if (probability >= model.threshold) {
      mentionedFacets.push(model.facet);
    }
    if (likelyKnown >= Math.max(0.4, model.threshold - 0.1)) {
      likelyKnownFacets.push(model.facet);
    }
  }

  return {
    mentionProbabilities,
    likelyKnownProbabilities,
    mentionedFacets,
    likelyKnownFacets,
  };
}

export function vectorizeText(
  text: string,
  artifact: FacetClassifierArtifact,
): number[] {
  const counts = new Map<number, number>();
  const terms = extractTerms(text, artifact);
  for (const term of terms) {
    const index = artifact.vocabulary[term];
    if (index === undefined) {
      continue;
    }
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }

  const dense = new Array<number>(artifact.terms.length).fill(0);
  let norm = 0;
  for (const [index, count] of counts.entries()) {
    const value = count * artifact.idf[index]!;
    dense[index] = value;
    norm += value * value;
  }
  if (!artifact.tokenizer.l2Normalize || norm === 0) {
    return dense;
  }
  const scale = Math.sqrt(norm);
  return dense.map((value) => value / scale);
}

export function extractTerms(
  text: string,
  artifact: Pick<FacetClassifierArtifact, "tokenizer">,
): string[] {
  const normalized = normalizeText(text, artifact.tokenizer.stripAccents);
  const regex = new RegExp(artifact.tokenizer.regex, "gu");
  const tokens = [...normalized.matchAll(regex)]
    .map((match) => match[0]!)
    .filter((token) => token.length >= artifact.tokenizer.minTokenLength)
    .map((token) => (artifact.tokenizer.lowercase ? token.toLowerCase() : token));

  const terms = [...tokens];
  if (artifact.tokenizer.ngramRange[1] >= 2) {
    for (let index = 0; index < tokens.length - 1; index += 1) {
      terms.push(`${tokens[index]} ${tokens[index + 1]}`);
    }
  }
  return terms;
}

function normalizeText(text: string, stripAccents: boolean): string {
  const normalized = stripAccents
    ? text.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    : text;
  return normalized;
}

function dot(vector: number[], coefficients: number[]): number {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index];
    if (value === 0) {
      continue;
    }
    sum += value * coefficients[index]!;
  }
  return sum;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
