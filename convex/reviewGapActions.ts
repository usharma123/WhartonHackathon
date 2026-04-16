"use node";

import OpenAI from "openai";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { createConvexActionStore, loadFacetClassifierArtifactFromConvex } from "./actionStore.js";
import { OpenAIReviewGapClient } from "../src/backend/ai.js";
import {
  analyzeDraftReview as analyzeDraftReviewService,
  confirmEnhancedReview as confirmEnhancedReviewService,
  finalizeReviewPreview as finalizeReviewPreviewService,
  selectNextQuestion as selectNextQuestionService,
  submitFollowUpAnswer as submitFollowUpAnswerService,
  updateStructuredReview as updateStructuredReviewService,
} from "../src/backend/service.js";
import type { RuntimeFacet } from "../src/backend/facets.js";

export const analyzeDraftReview = actionGeneric({
  args: {
    sessionId: v.string(),
    draftReview: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
    const classifierArtifact = await loadFacetClassifierArtifactFromConvex(ctx);
    return analyzeDraftReviewService(store, makeAIClient(), args, classifierArtifact);
  },
});

export const selectNextQuestion = actionGeneric({
  args: {
    sessionId: v.string(),
    draftReview: v.string(),
    includeSecondaryFacets: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
    const classifierArtifact = await loadFacetClassifierArtifactFromConvex(ctx);
    return selectNextQuestionService(store, makeAIClient(), args, classifierArtifact);
  },
});

export const submitFollowUpAnswer = actionGeneric({
  args: {
    sessionId: v.string(),
    facet: v.string(),
    answerText: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
    return submitFollowUpAnswerService(store, {
      sessionId: args.sessionId,
      facet: args.facet as RuntimeFacet,
      answerText: args.answerText,
    });
  },
});

export const finalizeReviewPreview = actionGeneric({
  args: {
    sessionId: v.string(),
    draftReview: v.string(),
    revisionNotes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
    return finalizeReviewPreviewService(store, makeAIClient(), {
      sessionId: args.sessionId,
      draftReview: args.draftReview,
      revisionNotes: args.revisionNotes,
    });
  },
});

export const updateStructuredReview = actionGeneric({
  args: {
    sessionId: v.string(),
    overallRating: v.number(),
    aspectRatings: v.optional(
      v.object({
        service: v.optional(v.number()),
        cleanliness: v.optional(v.number()),
        amenities: v.optional(v.number()),
        value: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
    return updateStructuredReviewService(store, args);
  },
});

export const confirmEnhancedReview = actionGeneric({
  args: {
    sessionId: v.string(),
    finalReviewText: v.string(),
    factCandidates: v.array(v.any()),
    confirmedFactIds: v.array(v.string()),
    editedFacts: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
    const classifierArtifact = await loadFacetClassifierArtifactFromConvex(ctx);
    const session = await store.getReviewSession(args.sessionId);
    const sourceReviewAggregate = session
      ? await ctx.runQuery(internal.reviewGapInternal.getSourceReviewAggregate, {
          propertyId: session.propertyId,
        })
      : null;
    await confirmEnhancedReviewService(
      store,
      {
        sessionId: args.sessionId,
        finalReviewText: args.finalReviewText,
        factCandidates: args.factCandidates,
        confirmedFactIds: args.confirmedFactIds,
        editedFacts: args.editedFacts,
        tokenIdentifier,
      },
      sourceReviewAggregate
        ? {
            reviewCount: sourceReviewAggregate.reviewCount,
            guestRating:
              typeof sourceReviewAggregate.guestRating === "number"
                ? sourceReviewAggregate.guestRating
                : undefined,
          }
        : undefined,
      classifierArtifact,
    );
    return { saved: true };
  },
});

function makeAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }
  return new OpenAIReviewGapClient(new OpenAI({ apiKey }));
}

async function requireTokenIdentifier(ctx: { auth: { getUserIdentity(): Promise<any> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return identity.tokenIdentifier as string;
}

async function requireSessionOwnership(
  store: ReturnType<typeof createConvexActionStore>,
  sessionId: string,
  tokenIdentifier: string,
) {
  const session = await store.getReviewSession(sessionId);
  if (!session || session.tokenIdentifier !== tokenIdentifier) {
    throw new Error("Unauthorized");
  }
}
