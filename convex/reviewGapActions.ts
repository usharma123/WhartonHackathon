"use node";

import OpenAI from "openai";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexActionStore, loadFacetClassifierArtifactFromConvex } from "./actionStore.js";
import { OpenAIReviewGapClient } from "../src/backend/ai.js";
import {
  analyzeDraftReview as analyzeDraftReviewService,
  selectNextQuestion as selectNextQuestionService,
  submitFollowUpAnswer as submitFollowUpAnswerService,
} from "../src/backend/service.js";
import type { RuntimeFacet } from "../src/backend/facets.js";

export const analyzeDraftReview = actionGeneric({
  args: {
    sessionId: v.string(),
    draftReview: v.string(),
  },
  handler: async (ctx, args) => {
    const store = createConvexActionStore(ctx);
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
    const store = createConvexActionStore(ctx);
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
    const store = createConvexActionStore(ctx);
    return submitFollowUpAnswerService(store, makeAIClient(), {
      sessionId: args.sessionId,
      facet: args.facet as RuntimeFacet,
      answerText: args.answerText,
    });
  },
});

function makeAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }
  return new OpenAIReviewGapClient(new OpenAI({ apiKey }));
}
