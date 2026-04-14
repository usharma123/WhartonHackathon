import { internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexStore } from "../src/backend/convexStore.js";

export const getProperty = internalQueryGeneric({
  args: { propertyId: v.string() },
  handler: async (ctx, args) => createConvexStore(ctx.db).getProperty(args.propertyId),
});

export const upsertProperty = internalMutationGeneric({
  args: { property: v.any() },
  handler: async (ctx, args) => createConvexStore(ctx.db).upsertProperty(args.property),
});

export const patchProperty = internalMutationGeneric({
  args: { propertyId: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).patchProperty(args.propertyId, args.patch),
});

export const getPropertyValidationState = internalQueryGeneric({
  args: { propertyId: v.string() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).getPropertyValidationState(args.propertyId),
});

export const listPropertyFacetMetrics = internalQueryGeneric({
  args: { propertyId: v.string() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).listPropertyFacetMetrics(args.propertyId),
});

export const upsertPropertyFacetMetric = internalMutationGeneric({
  args: { metric: v.any() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).upsertPropertyFacetMetric(args.metric),
});

export const listPropertyFacetLiveSignals = internalQueryGeneric({
  args: { propertyId: v.string() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).listPropertyFacetLiveSignals(args.propertyId),
});

export const replacePropertyFacetLiveSignals = internalMutationGeneric({
  args: { propertyId: v.string(), signals: v.array(v.any()) },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).replacePropertyFacetLiveSignals(args.propertyId, args.signals),
});

export const listPropertyFacetEvidence = internalQueryGeneric({
  args: { propertyId: v.string(), facet: v.optional(v.string()) },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).listPropertyFacetEvidence(args.propertyId, args.facet as any),
});

export const createReviewSession = internalMutationGeneric({
  args: { session: v.any() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).createReviewSession(args.session),
});

export const getReviewSession = internalQueryGeneric({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => createConvexStore(ctx.db).getReviewSession(args.sessionId),
});

export const updateReviewSession = internalMutationGeneric({
  args: { sessionId: v.string(), patch: v.any() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).updateReviewSession(args.sessionId, args.patch),
});

export const createFollowUpQuestion = internalMutationGeneric({
  args: { question: v.any() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).createFollowUpQuestion(args.question),
});

export const getLatestFollowUpQuestion = internalQueryGeneric({
  args: { sessionId: v.string() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).getLatestFollowUpQuestion(args.sessionId),
});

export const createFollowUpAnswer = internalMutationGeneric({
  args: { answer: v.any() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).createFollowUpAnswer(args.answer),
});

export const getLatestFollowUpAnswer = internalQueryGeneric({
  args: { sessionId: v.string() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).getLatestFollowUpAnswer(args.sessionId),
});

export const appendPropertyEvidenceUpdates = internalMutationGeneric({
  args: { updates: v.array(v.any()) },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).appendPropertyEvidenceUpdates(args.updates),
});

export const replacePropertyFacetVendorEvidence = internalMutationGeneric({
  args: {
    propertyId: v.string(),
    facet: v.string(),
    vendor: v.literal("expedia"),
    evidence: v.array(v.any()),
  },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).replacePropertyFacetVendorEvidence(
      args.propertyId,
      args.facet as any,
      args.vendor,
      args.evidence,
    ),
});

export const replacePropertyLiveReviews = internalMutationGeneric({
  args: { propertyId: v.string(), reviews: v.array(v.any()) },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).replacePropertyLiveReviews(args.propertyId, args.reviews),
});

export const listPropertyEvidenceUpdatesBySession = internalQueryGeneric({
  args: { sessionId: v.string() },
  handler: async (ctx, args) =>
    createConvexStore(ctx.db).listPropertyEvidenceUpdatesBySession(args.sessionId),
});

export const getFacetClassifierArtifact = internalQueryGeneric({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("mlRuntimeArtifacts")
      .withIndex("by_artifact_type", (q) => q.eq("artifactType", "facet_classifier"))
      .unique();
    return doc ?? null;
  },
});
