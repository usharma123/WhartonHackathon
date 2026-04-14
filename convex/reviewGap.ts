import OpenAI from "openai";
import { actionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexActionStore } from "./actionStore.js";
import { loadFacetClassifierArtifactFromConvex } from "./actionStore.js";
import { createConvexStore } from "../src/backend/convexStore.js";
import { OpenAIReviewGapClient } from "../src/backend/ai.js";
import {
  analyzeDraftReview as analyzeDraftReviewService,
  createReviewSession as createReviewSessionService,
  getSessionSummary as getSessionSummaryService,
  selectNextQuestion as selectNextQuestionService,
  submitFollowUpAnswer as submitFollowUpAnswerService,
} from "../src/backend/service.js";
import type { RuntimeFacet } from "../src/backend/facets.js";

export const listDemoProperties = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("properties").collect();
    return docs
      .filter((doc) => (doc.demoFlags ?? []).includes("demo"))
      .sort((left, right) => String(left.demoScenario ?? "").localeCompare(String(right.demoScenario ?? "")))
      .map((doc) => ({
        propertyId: doc.propertyId,
        city: doc.city ?? undefined,
        province: doc.province ?? undefined,
        country: doc.country ?? undefined,
        propertySummary: doc.propertySummary,
        demoFlags: doc.demoFlags ?? [],
        demoScenario: doc.demoScenario ?? undefined,
      }));
  },
});

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

export const getSessionSummary = queryGeneric({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    return getSessionSummaryService(store, args.sessionId);
  },
});

function makeAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }
  return new OpenAIReviewGapClient(new OpenAI({ apiKey }));
}
