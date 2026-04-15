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
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const [{ createConvexStore }, { createReviewSession: createReviewSessionService }] =
      await Promise.all([
        import("../src/backend/convexStore.js"),
        import("../src/backend/service.js"),
      ]);
    const store = createConvexStore(ctx.db);
    const classifierArtifact = await loadFacetClassifierArtifactFromDb(ctx.db);
    return createReviewSessionService(store, { ...args, tokenIdentifier }, classifierArtifact);
  },
});

export const analyzeDraftReview = actionGeneric({
  args: {
    sessionId: v.string(),
    draftReview: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const [
      { createConvexActionStore, loadFacetClassifierArtifactFromConvex },
      { analyzeDraftReview: analyzeDraftReviewService },
    ] = await Promise.all([
      import("./actionStore.js"),
      import("../src/backend/service.js"),
    ]);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
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
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const [
      { createConvexActionStore, loadFacetClassifierArtifactFromConvex },
      { selectNextQuestion: selectNextQuestionService },
    ] = await Promise.all([
      import("./actionStore.js"),
      import("../src/backend/service.js"),
    ]);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
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
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const [
      { createConvexActionStore, loadFacetClassifierArtifactFromConvex },
      { submitFollowUpAnswer: submitFollowUpAnswerService },
    ] = await Promise.all([
      import("./actionStore.js"),
      import("../src/backend/service.js"),
    ]);
    const store = createConvexActionStore(ctx);
    await requireSessionOwnership(store, args.sessionId, tokenIdentifier);
    return submitFollowUpAnswerService(store, {
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
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const [{ createConvexStore }, { getSessionSummary: getSessionSummaryService }] =
      await Promise.all([
        import("../src/backend/convexStore.js"),
        import("../src/backend/service.js"),
      ]);
    const store = createConvexStore(ctx.db);
    const session = await store.getReviewSession(args.sessionId);
    if (!session || session.tokenIdentifier !== tokenIdentifier) {
      throw new Error("Unauthorized");
    }
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

async function requireTokenIdentifier(ctx: { auth: { getUserIdentity(): Promise<any> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return identity.tokenIdentifier as string;
}

async function requireSessionOwnership(
  store: { getReviewSession(sessionId: string): Promise<{ tokenIdentifier?: string } | null> },
  sessionId: string,
  tokenIdentifier: string,
) {
  const session = await store.getReviewSession(sessionId);
  if (!session || session.tokenIdentifier !== tokenIdentifier) {
    throw new Error("Unauthorized");
  }
}

async function loadFacetClassifierArtifactFromDb(db: any) {
  const doc = await db
    .query("mlRuntimeArtifacts")
    .withIndex("by_artifact_type", (q: any) => q.eq("artifactType", "facet_classifier"))
    .unique();
  if (!doc) {
    return undefined;
  }
  return {
    artifactType: "facet_classifier" as const,
    version: doc.version,
    generatedAt: doc.generatedAt,
    tokenizer: {
      regex: doc.tokenizer.regex,
      minTokenLength: doc.tokenizer.minTokenLength,
      ngramRange: [doc.tokenizer.ngramRange[0], doc.tokenizer.ngramRange[1]] as [number, number],
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
