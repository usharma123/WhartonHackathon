import { actionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

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
        ...(doc.city ? { city: doc.city } : {}),
        ...(doc.province ? { province: doc.province } : {}),
        ...(doc.country ? { country: doc.country } : {}),
        propertySummary: doc.propertySummary,
        demoFlags: doc.demoFlags ?? [],
        ...(doc.demoScenario ? { demoScenario: doc.demoScenario } : {}),
      }));
  },
});

export const createReviewSession = mutationGeneric({
  args: {
    propertyId: v.string(),
    draftReview: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [{ createConvexStore }, { createReviewSession: createReviewSessionService }] =
      await Promise.all([
        import("../src/backend/convexStore.js"),
        import("../src/backend/service.js"),
      ]);
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
    const [
      { createConvexActionStore, loadFacetClassifierArtifactFromConvex },
      { analyzeDraftReview: analyzeDraftReviewService },
    ] = await Promise.all([
      import("./actionStore.js"),
      import("../src/backend/service.js"),
    ]);
    const store = createConvexActionStore(ctx);
    const classifierArtifact = await loadFacetClassifierArtifactFromConvex(ctx);
    return analyzeDraftReviewService(store, await makeAIClient(), args, classifierArtifact);
  },
});

export const selectNextQuestion = actionGeneric({
  args: {
    sessionId: v.string(),
    draftReview: v.string(),
    includeSecondaryFacets: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const [
      { createConvexActionStore, loadFacetClassifierArtifactFromConvex },
      { selectNextQuestion: selectNextQuestionService },
    ] = await Promise.all([
      import("./actionStore.js"),
      import("../src/backend/service.js"),
    ]);
    const store = createConvexActionStore(ctx);
    const classifierArtifact = await loadFacetClassifierArtifactFromConvex(ctx);
    return selectNextQuestionService(store, await makeAIClient(), args, classifierArtifact);
  },
});

export const submitFollowUpAnswer = actionGeneric({
  args: {
    sessionId: v.string(),
    facet: v.string(),
    answerText: v.string(),
  },
  handler: async (ctx, args) => {
    const [
      { createConvexActionStore },
      { submitFollowUpAnswer: submitFollowUpAnswerService },
    ] = await Promise.all([
      import("./actionStore.js"),
      import("../src/backend/service.js"),
    ]);
    const store = createConvexActionStore(ctx);
    return submitFollowUpAnswerService(store, await makeAIClient(), {
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
    const [{ createConvexStore }, { getSessionSummary: getSessionSummaryService }] =
      await Promise.all([
        import("../src/backend/convexStore.js"),
        import("../src/backend/service.js"),
      ]);
    const store = createConvexStore(ctx.db);
    return getSessionSummaryService(store, args.sessionId);
  },
});

async function makeAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }
  const [{ default: OpenAI }, { OpenAIReviewGapClient }] = await Promise.all([
    import("openai"),
    import("../src/backend/ai.js"),
  ]);
  return new OpenAIReviewGapClient(new OpenAI({ apiKey }));
}
