import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexStore } from "../src/backend/convexStore.js";
import {
  analyzeDraftReview as analyzeDraftReviewService,
  createReviewSession as createReviewSessionService,
  getSessionSummary as getSessionSummaryService,
  selectNextQuestion as selectNextQuestionService,
  submitFollowUpAnswer as submitFollowUpAnswerService,
} from "../src/backend/service.js";

// This scaffold uses deterministic fallbacks in Convex handlers.
// Wire a live OpenAIReviewGapClient into action handlers when the deployed
// Convex environment is available.

export const createReviewSession = mutationGeneric({
  args: {
    propertyId: v.string(),
    draftReview: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    return createReviewSessionService(store, args);
  },
});

export const analyzeDraftReview = mutationGeneric({
  args: {
    sessionId: v.string(),
    draftReview: v.string(),
  },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    return analyzeDraftReviewService(store, undefined, args);
  },
});

export const selectNextQuestion = mutationGeneric({
  args: {
    sessionId: v.string(),
    draftReview: v.string(),
    includeSecondaryFacets: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    return selectNextQuestionService(store, undefined, args);
  },
});

export const submitFollowUpAnswer = mutationGeneric({
  args: {
    sessionId: v.string(),
    facet: v.string(),
    answerText: v.string(),
  },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    return submitFollowUpAnswerService(store, undefined, {
      sessionId: args.sessionId,
      facet: args.facet as any,
      answerText: args.answerText,
    });
  },
});

export const getSessionSummary = queryGeneric({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    return getSessionSummaryService(store, args.sessionId);
  },
});
