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
    const [sourceDocs, runtimeDocs, reviewDocs] = await Promise.all([
      ctx.db.query("sourceProperties").collect(),
      ctx.db.query("properties").collect(),
      ctx.db.query("sourceReviews").collect(),
    ]);

    const runtimeByPropertyId = new Map(
      runtimeDocs.map((doc) => [doc.propertyId, doc] as const),
    );
    const reviewCountByPropertyId = new Map<string, number>();
    for (const review of reviewDocs) {
      reviewCountByPropertyId.set(
        review.propertyId,
        (reviewCountByPropertyId.get(review.propertyId) ?? 0) + 1,
      );
    }

    return sourceDocs
      .map((sourceDoc) => {
        const runtimeDoc = runtimeByPropertyId.get(sourceDoc.propertyId);
        return {
          propertyId: sourceDoc.propertyId,
          ...(sourceDoc.city ? { city: sourceDoc.city } : {}),
          ...(sourceDoc.province ? { province: sourceDoc.province } : {}),
          ...(sourceDoc.country ? { country: sourceDoc.country } : {}),
          ...(parseOptionalNumber(sourceDoc.starRating) !== undefined
            ? { starRating: parseOptionalNumber(sourceDoc.starRating) }
            : {}),
          ...(runtimeDoc?.guestRating !== undefined
            ? { guestRating: runtimeDoc.guestRating }
            : parseOptionalNumber(sourceDoc.guestRatingAvgExpedia) !== undefined
              ? { guestRating: parseOptionalNumber(sourceDoc.guestRatingAvgExpedia) }
              : {}),
          propertySummary:
            runtimeDoc?.propertySummary ?? buildSourcePropertySummary(sourceDoc),
          ...(runtimeDoc?.popularAmenities ?? sourceDoc.popularAmenitiesList
            ? {
                popularAmenities:
                  runtimeDoc?.popularAmenities ??
                  normalizeText(sourceDoc.popularAmenitiesList),
              }
            : {}),
          reviewCount: reviewCountByPropertyId.get(sourceDoc.propertyId) ?? 0,
          demoFlags: runtimeDoc?.demoFlags ?? [],
          ...(runtimeDoc?.demoScenario ? { demoScenario: runtimeDoc.demoScenario } : {}),
        };
      })
      .sort((left, right) => {
        const leftDemo = left.demoFlags.includes("demo") ? 0 : 1;
        const rightDemo = right.demoFlags.includes("demo") ? 0 : 1;
        if (leftDemo !== rightDemo) {
          return leftDemo - rightDemo;
        }
        return String(left.city ?? left.propertyId).localeCompare(
          String(right.city ?? right.propertyId),
        );
      });
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

function buildSourcePropertySummary(sourceDoc: {
  city: string;
  province: string;
  country: string;
  propertyDescription: string;
  areaDescription: string;
}): string {
  const location = [sourceDoc.city, sourceDoc.province, sourceDoc.country]
    .map(normalizeText)
    .filter((value): value is string => Boolean(value))
    .join(", ");
  const description =
    normalizeText(sourceDoc.propertyDescription) ??
    normalizeText(sourceDoc.areaDescription) ??
    "Seeded from the source dataset.";
  return [location, description].filter(Boolean).join(". ");
}

function normalizeText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
