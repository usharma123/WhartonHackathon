import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexStore } from "../src/backend/convexStore.js";
import {
  createReviewSession as createReviewSessionService,
  getSessionSummary as getSessionSummaryService,
} from "../src/backend/service.js";

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
    const store = createConvexStore(ctx.db);
    return createReviewSessionService(store, args);
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
