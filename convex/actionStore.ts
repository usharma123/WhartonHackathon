import type { ReviewGapStore } from "../src/backend/store.js";
import type { FacetClassifierArtifact } from "../src/backend/ml.js";
import type { PropertyRecord } from "../src/backend/types.js";

type ActionCtx = {
  runQuery: (ref: any, args: any) => Promise<any>;
  runMutation: (ref: any, args: any) => Promise<any>;
};

const refs = {
  getProperty: "reviewGapInternal:getProperty",
  patchProperty: "reviewGapInternal:patchProperty",
  listPropertyFacetMetrics: "reviewGapInternal:listPropertyFacetMetrics",
  listPropertyFacetLiveSignals: "reviewGapInternal:listPropertyFacetLiveSignals",
  replacePropertyFacetLiveSignals: "reviewGapInternal:replacePropertyFacetLiveSignals",
  listPropertyFacetEvidence: "reviewGapInternal:listPropertyFacetEvidence",
  listPropertyLiveReviews: "reviewGapInternal:listPropertyLiveReviews",
  replacePropertyFacetVendorEvidence: "reviewGapInternal:replacePropertyFacetVendorEvidence",
  replacePropertyFacetSourceEvidence: "reviewGapInternal:replacePropertyFacetSourceEvidence",
  replacePropertyLiveReviews: "reviewGapInternal:replacePropertyLiveReviews",
  upsertPropertyLiveReview: "reviewGapInternal:upsertPropertyLiveReview",
  createReviewSession: "reviewGapInternal:createReviewSession",
  getReviewSession: "reviewGapInternal:getReviewSession",
  updateReviewSession: "reviewGapInternal:updateReviewSession",
  createFollowUpQuestion: "reviewGapInternal:createFollowUpQuestion",
  getLatestFollowUpQuestion: "reviewGapInternal:getLatestFollowUpQuestion",
  createFollowUpAnswer: "reviewGapInternal:createFollowUpAnswer",
  getLatestFollowUpAnswer: "reviewGapInternal:getLatestFollowUpAnswer",
  listFollowUpAnswers: "reviewGapInternal:listFollowUpAnswers",
  appendPropertyEvidenceUpdates: "reviewGapInternal:appendPropertyEvidenceUpdates",
  listPropertyEvidenceUpdatesBySession: "reviewGapInternal:listPropertyEvidenceUpdatesBySession",
  upsertUserPropertyReview: "reviewGapInternal:upsertUserPropertyReview",
  listUserPropertyReviews: "reviewGapInternal:listUserPropertyReviews",
  getFacetClassifierArtifact: "reviewGapInternal:getFacetClassifierArtifact",
} as const;

export function createConvexActionStore(ctx: ActionCtx): ReviewGapStore {
  return {
    now: () => new Date().toISOString(),
    async getProperty(propertyId) {
      return ctx.runQuery(refs.getProperty as any, { propertyId });
    },
    async upsertProperty() {
      throw new Error("upsertProperty is not supported from runtime actions.");
    },
    async patchProperty(propertyId, patch) {
      return ctx.runMutation(refs.patchProperty as any, { propertyId, patch });
    },
    async getPropertyValidationState() {
      throw new Error("getPropertyValidationState is not supported from runtime actions.");
    },
    async listPropertyFacetMetrics(propertyId) {
      return ctx.runQuery(refs.listPropertyFacetMetrics as any, { propertyId });
    },
    async upsertPropertyFacetMetric() {
      throw new Error("upsertPropertyFacetMetric is not supported from runtime actions.");
    },
    async listPropertyFacetLiveSignals(propertyId) {
      return ctx.runQuery(refs.listPropertyFacetLiveSignals as any, { propertyId });
    },
    async replacePropertyFacetLiveSignals(propertyId, signals) {
      return ctx.runMutation(refs.replacePropertyFacetLiveSignals as any, { propertyId, signals });
    },
    async listPropertyFacetEvidence(propertyId, facet) {
      return ctx.runQuery(refs.listPropertyFacetEvidence as any, { propertyId, facet });
    },
    async replacePropertyFacetEvidence() {
      throw new Error("replacePropertyFacetEvidence is not supported from runtime actions.");
    },
    async replacePropertyFacetVendorEvidence(propertyId, facet, vendor, evidence) {
      return ctx.runMutation(refs.replacePropertyFacetVendorEvidence as any, {
        propertyId,
        facet,
        vendor,
        evidence,
      });
    },
    async listPropertyLiveReviews(propertyId) {
      return ctx.runQuery(refs.listPropertyLiveReviews as any, { propertyId });
    },
    async replacePropertyLiveReviews(propertyId, reviews) {
      return ctx.runMutation(refs.replacePropertyLiveReviews as any, { propertyId, reviews });
    },
    async upsertPropertyLiveReview(review) {
      return ctx.runMutation(refs.upsertPropertyLiveReview as any, { review });
    },
    async createReviewSession(session) {
      return ctx.runMutation(refs.createReviewSession as any, { session });
    },
    async getReviewSession(sessionId) {
      return ctx.runQuery(refs.getReviewSession as any, { sessionId });
    },
    async updateReviewSession(sessionId, patch) {
      return ctx.runMutation(refs.updateReviewSession as any, { sessionId, patch });
    },
    async createFollowUpQuestion(question) {
      return ctx.runMutation(refs.createFollowUpQuestion as any, { question });
    },
    async getLatestFollowUpQuestion(sessionId) {
      return ctx.runQuery(refs.getLatestFollowUpQuestion as any, { sessionId });
    },
    async createFollowUpAnswer(answer) {
      return ctx.runMutation(refs.createFollowUpAnswer as any, { answer });
    },
    async getLatestFollowUpAnswer(sessionId) {
      return ctx.runQuery(refs.getLatestFollowUpAnswer as any, { sessionId });
    },
    async listFollowUpAnswers(sessionId) {
      return ctx.runQuery(refs.listFollowUpAnswers as any, { sessionId });
    },
    async appendPropertyEvidenceUpdates(updates) {
      return ctx.runMutation(refs.appendPropertyEvidenceUpdates as any, { updates });
    },
    async listPropertyEvidenceUpdatesBySession(sessionId) {
      return ctx.runQuery(refs.listPropertyEvidenceUpdatesBySession as any, { sessionId });
    },
    async replacePropertyFacetSourceEvidence(propertyId, facet, sourcePrefix, evidence) {
      return ctx.runMutation(refs.replacePropertyFacetSourceEvidence as any, {
        propertyId,
        facet,
        sourcePrefix,
        evidence,
      });
    },
    async upsertUserPropertyReview(review) {
      return ctx.runMutation(refs.upsertUserPropertyReview as any, { review });
    },
    async listUserPropertyReviews(propertyId) {
      return ctx.runQuery(refs.listUserPropertyReviews as any, { propertyId });
    },
  };
}

export async function loadFacetClassifierArtifactFromConvex(
  ctx: ActionCtx,
): Promise<FacetClassifierArtifact | undefined> {
  const doc = await ctx.runQuery(refs.getFacetClassifierArtifact as any, {});
  if (!doc) {
    return undefined;
  }
  return {
    artifactType: "facet_classifier",
    version: doc.version,
    generatedAt: doc.generatedAt,
    tokenizer: {
      regex: doc.tokenizer.regex,
      minTokenLength: doc.tokenizer.minTokenLength,
      ngramRange: [doc.tokenizer.ngramRange[0], doc.tokenizer.ngramRange[1]],
      lowercase: doc.tokenizer.lowercase,
      stripAccents: doc.tokenizer.stripAccents,
      l2Normalize: doc.tokenizer.l2Normalize,
    },
    runtimeFacets: doc.runtimeFacets,
    vocabulary: Object.fromEntries(
      doc.vocabularyEntries.map((entry: { term: string; index: number }) => [
        entry.term,
        entry.index,
      ]),
    ),
    terms: doc.terms,
    idf: doc.idf,
    models: doc.models,
  };
}

export type DemoPropertySummary = Pick<
  PropertyRecord,
  "propertyId" | "city" | "province" | "country" | "propertySummary" | "demoFlags" | "demoScenario"
>;
