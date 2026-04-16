import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexStore } from "../src/backend/convexStore.js";
import type { FacetClassifierArtifact } from "../src/backend/ml.js";
import { rankFacetMetrics } from "../src/backend/scoring.js";
import {
  createReviewSession as createReviewSessionService,
  getSessionSummary as getSessionSummaryService,
} from "../src/backend/service.js";

export const listDemoProperties = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const [sourceDocs, runtimeDocs, reviewDocs, userReviewDocs] = await Promise.all([
      ctx.db.query("sourceProperties").collect(),
      ctx.db.query("properties").collect(),
      ctx.db.query("sourceReviews").collect(),
      ctx.db.query("userPropertyReviews").collect(),
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
    const userReviewsByPropertyId = new Map<string, Array<{ overallRating?: number }>>();
    for (const review of userReviewDocs) {
      const existing = userReviewsByPropertyId.get(review.propertyId) ?? [];
      existing.push({ overallRating: review.overallRating ?? undefined });
      userReviewsByPropertyId.set(review.propertyId, existing);
    }

    return sourceDocs
      .map((sourceDoc) => {
        const runtimeDoc = runtimeByPropertyId.get(sourceDoc.propertyId);
        const seedReviewCount = reviewCountByPropertyId.get(sourceDoc.propertyId) ?? 0;
        const firstPartyReviews = userReviewsByPropertyId.get(sourceDoc.propertyId) ?? [];
        const guestRating = blendGuestRating(
          runtimeDoc?.guestRating,
          parseOptionalNumber(sourceDoc.guestRatingAvgExpedia),
          seedReviewCount,
          firstPartyReviews,
        );
        return {
          propertyId: sourceDoc.propertyId,
          ...(sourceDoc.city ? { city: sourceDoc.city } : {}),
          ...(sourceDoc.province ? { province: sourceDoc.province } : {}),
          ...(sourceDoc.country ? { country: sourceDoc.country } : {}),
          ...(parseOptionalNumber(sourceDoc.starRating) !== undefined
            ? { starRating: parseOptionalNumber(sourceDoc.starRating) }
            : {}),
          ...(guestRating !== undefined ? { guestRating } : {}),
          propertySummary:
            runtimeDoc?.propertySummary ?? buildSourcePropertySummary(sourceDoc),
          ...(runtimeDoc?.popularAmenities ?? sourceDoc.popularAmenitiesList
            ? {
                popularAmenities:
                  summarizeAmenities(runtimeDoc?.popularAmenities ?? sourceDoc.popularAmenitiesList),
              }
            : {}),
          reviewCount: seedReviewCount + firstPartyReviews.length,
          vendorReviewCount: runtimeDoc?.vendorReviewCount ?? seedReviewCount,
          firstPartyReviewCount:
            runtimeDoc?.firstPartyReviewCount ?? firstPartyReviews.length,
          liveReviewCount: runtimeDoc?.liveReviewCount ?? firstPartyReviews.length,
          lastRecomputedAt: runtimeDoc?.lastRecomputedAt ?? undefined,
          recomputeStatus: runtimeDoc?.recomputeStatus ?? "idle",
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

export const getPropertyDetail = queryGeneric({
  args: { propertyId: v.string() },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    const [sourceDoc, runtimeDoc, evidenceDocs, liveSignals, sourceReviews, userReviews, metrics] = await Promise.all([
      ctx.db
        .query("sourceProperties")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .unique(),
      ctx.db
        .query("properties")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .unique(),
      ctx.db
        .query("propertyFacetEvidence")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .collect(),
      ctx.db
        .query("propertyFacetLiveSignals")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .collect(),
      ctx.db
        .query("sourceReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .collect(),
      ctx.db
        .query("userPropertyReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .collect(),
      store.listPropertyFacetMetrics(args.propertyId),
    ]);
    if (!sourceDoc) return null;

    const popularAmenities =
      summarizeAmenities(runtimeDoc?.popularAmenities ?? sourceDoc.popularAmenitiesList) ?? "";
    const amenityGroups: Array<{ label: string; items: string[] }> = [
      { label: "Popular", items: splitList(popularAmenities) },
      { label: "Food & Drink", items: splitList(sourceDoc.propertyAmenityFoodAndDrink) },
      { label: "Outdoor", items: splitList(sourceDoc.propertyAmenityOutdoor) },
      { label: "Internet", items: splitList(sourceDoc.propertyAmenityInternet) },
      { label: "Family", items: splitList(sourceDoc.propertyAmenityFamilyFriendly) },
      { label: "Parking", items: splitList(sourceDoc.propertyAmenityParking) },
      { label: "Guest Services", items: splitList(sourceDoc.propertyAmenityGuestServices) },
      { label: "Things to Do", items: splitList(sourceDoc.propertyAmenityThingsToDo) },
    ].filter((group) => group.items.length > 0);

    const addedFacets = new Set<string>();
    const highlights: Array<{ facet: string; snippet: string; source: string }> = [];
    for (const doc of evidenceDocs) {
      if (addedFacets.has(doc.facet)) continue;
      if (!doc.snippet?.trim()) continue;
      addedFacets.add(doc.facet);
      highlights.push({
        facet: formatFacetLabel(doc.facet),
        snippet: formatEvidenceSnippet(doc.snippet),
        source: doc.sourceType,
      });
      if (highlights.length >= 6) break;
    }

    const blendedGuestRating = blendGuestRating(
      runtimeDoc?.guestRating,
      parseOptionalNumber(sourceDoc.guestRatingAvgExpedia),
      sourceReviews.length,
      userReviews.map((review) => ({ overallRating: review.overallRating ?? undefined })),
    );
    const topProvenance = rankFacetMetrics(
      metrics,
      { mentionedFacets: [], likelyKnownFacets: [] },
      { includeSecondaryFacets: true },
    )[0];
    const scoreProvenance = topProvenance
      ? {
          topFacet: topProvenance.facet,
          summary: `${formatFacetLabel(topProvenance.facet)} is currently driven by ${
            topProvenance.scoreBreakdown.topDriver ?? "deterministic ranking"
          } with ${topProvenance.scoreBreakdown.sampleSize ?? 0} live reviews in scope.`,
          sampleSize: topProvenance.scoreBreakdown.sampleSize ?? 0,
          evidenceMix: topProvenance.scoreBreakdown.evidenceMix ?? "none",
          topDriver: topProvenance.scoreBreakdown.topDriver ?? "deterministic_ranking",
        }
      : {
          summary: "No live score provenance is available yet.",
          sampleSize: 0,
          evidenceMix: "none" as const,
          topDriver: "no_live_evidence",
        };

    return {
      propertyId: sourceDoc.propertyId,
      city: sourceDoc.city,
      province: sourceDoc.province,
      country: sourceDoc.country,
      starRating: parseOptionalNumber(sourceDoc.starRating),
      guestRating: blendedGuestRating,
      propertySummary:
        runtimeDoc?.propertySummary ?? buildSourcePropertySummary(sourceDoc),
      areaDescription: normalizeText(sourceDoc.areaDescription) ?? "",
      propertyDescription: normalizeText(sourceDoc.propertyDescription) ?? "",
      knowBeforeYouGo: normalizeText(sourceDoc.knowBeforeYouGo) ?? "",
      checkInWindow:
        [sourceDoc.checkInStartTime, sourceDoc.checkInEndTime].filter(Boolean).join(" – ") || "",
      checkOutTime: sourceDoc.checkOutTime ?? "",
      petPolicy: normalizeText(sourceDoc.petPolicy) ?? "",
      demoScenario: runtimeDoc?.demoScenario ?? "",
      demoFlags: runtimeDoc?.demoFlags ?? [],
      popularAmenities,
      amenityGroups,
      vendorReviewCount: runtimeDoc?.vendorReviewCount ?? sourceReviews.length,
      firstPartyReviewCount: runtimeDoc?.firstPartyReviewCount ?? userReviews.length,
      liveReviewCount: runtimeDoc?.liveReviewCount ?? 0,
      lastRecomputedAt: runtimeDoc?.lastRecomputedAt ?? "",
      recomputeStatus: runtimeDoc?.recomputeStatus ?? "idle",
      scoreProvenance,
      highlights,
      liveSignalCount: liveSignals.length,
    };
  },
});

export const listPropertyReviews = queryGeneric({
  args: { propertyId: v.string() },
  handler: async (ctx, args) => {
    const [sourceReviews, userReviews, liveReviews] = await Promise.all([
      ctx.db
        .query("sourceReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .collect(),
      ctx.db
        .query("userPropertyReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .collect(),
      ctx.db
        .query("propertyLiveReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", args.propertyId))
        .collect(),
    ]);

    const items: Array<{
      id: string;
      kind: "seed" | "traveler";
      title: string;
      text: string;
      rating: number | null;
      reviewDate: string;
      factCount: number;
      sentiment: string | null;
    }> = [];

    for (const doc of userReviews) {
      items.push({
        id: String(doc._id),
        kind: "traveler",
        title: "Enhanced review",
        text: doc.reviewText,
        rating: doc.overallRating ?? null,
        reviewDate: doc.updatedAt,
        factCount: doc.factCount ?? 0,
        sentiment: doc.sentiment ?? null,
      });
    }

    for (const doc of sourceReviews) {
      items.push({
        id: String(doc._id),
        kind: "seed",
        title: doc.reviewTitle || "Traveler review",
        text: doc.reviewText,
        rating: extractRating(doc.ratingJson),
        reviewDate: doc.acquisitionDate,
        factCount: 0,
        sentiment: null,
      });
    }

    items.sort((left, right) => {
      const kindOrder = left.kind === right.kind ? 0 : left.kind === "traveler" ? -1 : 1;
      if (kindOrder !== 0) {
        return kindOrder;
      }
      return (right.reviewDate ?? "").localeCompare(left.reviewDate ?? "");
    });

    return {
      reviews: items.slice(0, 30),
      counts: {
        total: items.length,
        traveler: userReviews.length,
        seed: sourceReviews.length,
        live: liveReviews.length,
      },
    };
  },
});

function splitList(value: string | undefined): string[] {
  return parseListItems(value).slice(0, 8);
}

function extractRating(ratingJson: string | undefined): number | null {
  if (!ratingJson) return null;
  try {
    const parsed = JSON.parse(ratingJson);
    if (typeof parsed === "number") return parsed;
    if (parsed && typeof parsed === "object") {
      for (const key of ["overall", "rating", "score"]) {
        const candidate = Number((parsed as Record<string, unknown>)[key]);
        if (Number.isFinite(candidate)) return candidate;
      }
    }
  } catch {
    const match = /([0-9]+(?:\.[0-9]+)?)/.exec(ratingJson);
    if (match) {
      const candidate = Number(match[1]);
      if (Number.isFinite(candidate)) return candidate;
    }
  }
  return null;
}

function blendGuestRating(
  runtimeGuestRating: number | undefined,
  seedGuestRating: number | undefined,
  seedReviewCount: number,
  firstPartyReviews: Array<{ overallRating?: number }>,
): number | undefined {
  const firstPartyRatings = firstPartyReviews
    .map((review) => review.overallRating)
    .filter((rating): rating is number => typeof rating === "number" && Number.isFinite(rating));
  const firstPartyCount = firstPartyRatings.length;
  if (firstPartyCount === 0) {
    return runtimeGuestRating ?? seedGuestRating;
  }
  if (typeof runtimeGuestRating === "number" && Number.isFinite(runtimeGuestRating)) {
    return runtimeGuestRating;
  }
  const firstPartyAverage =
    firstPartyRatings.reduce((sum, rating) => sum + rating, 0) / firstPartyCount;
  const seed = runtimeGuestRating ?? seedGuestRating;
  if (typeof seed !== "number" || !Number.isFinite(seed) || seedReviewCount <= 0) {
    return roundRating(firstPartyAverage);
  }
  return roundRating(
    ((seed * seedReviewCount) + (firstPartyAverage * firstPartyCount)) /
      (seedReviewCount + firstPartyCount),
  );
}

function roundRating(value: number): number {
  return Math.round(value * 10) / 10;
}

export const createReviewSession = mutationGeneric({
  args: {
    propertyId: v.string(),
    draftReview: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const store = createConvexStore(ctx.db);
    const classifierArtifact = await loadFacetClassifierArtifactFromDb(ctx.db);
    return createReviewSessionService(
      store,
      { ...args, tokenIdentifier },
      classifierArtifact,
    );
  },
});

export const getSessionSummary = queryGeneric({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenIdentifier = await requireTokenIdentifier(ctx);
    const store = createConvexStore(ctx.db);
    const session = await store.getReviewSession(args.sessionId);
    if (!session || session.tokenIdentifier !== tokenIdentifier) {
      throw new Error("Unauthorized");
    }
    return getSessionSummaryService(store, args.sessionId);
  },
});

async function requireTokenIdentifier(ctx: { auth: { getUserIdentity(): Promise<any> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return identity.tokenIdentifier as string;
}

async function loadFacetClassifierArtifactFromDb(db: any): Promise<FacetClassifierArtifact | undefined> {
  const doc = await db
    .query("mlRuntimeArtifacts")
    .withIndex("by_artifact_type", (q: any) => q.eq("artifactType", "facet_classifier"))
    .unique();
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

function summarizeAmenities(value: string | undefined): string | undefined {
  const items = parseListItems(value);
  return items.length > 0 ? items.join("; ") : undefined;
}

function parseListItems(value: string | undefined): string[] {
  const text = normalizeText(value);
  if (!text) return [];

  const parsedArray = parseSerializedArray(text);
  const rawItems =
    parsedArray ??
    text
      .split(/[;|\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

  return [...new Set(rawItems.map(formatAmenityItem).filter(Boolean))];
}

function parseSerializedArray(text: string): string[] | null {
  if (!(text.startsWith("[") && text.endsWith("]"))) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
    }
  } catch {
    const matches = [...text.matchAll(/"([^"]+)"|'([^']+)'/g)]
      .map((match) => (match[1] ?? match[2] ?? "").trim())
      .filter(Boolean);
    if (matches.length > 0) {
      return matches;
    }
  }

  return null;
}

function formatAmenityItem(value: string): string {
  const cleaned = value
    .replace(/^[\["'\s]+|[\]"'\s]+$/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const lower = cleaned.toLowerCase();
  const exactMap: Record<string, string> = {
    ac: "A/C",
    bar: "Bar",
    crib: "Crib",
    elevator: "Elevator",
    heater: "Heating",
    tv: "TV",
    wifi: "Wi-Fi",
    "free parking": "Free parking",
    "breakfast available": "Breakfast available",
    "business services": "Business services",
    "fitness equipment": "Fitness equipment",
    "frontdesk 24 hour": "24-hour front desk",
    grocery: "Grocery store",
    internet: "Internet access",
    laundry: "Laundry",
    "no smoking": "Smoke-free",
    pool: "Pool",
    restaurant: "Restaurant",
    "room service": "Room service",
  };

  if (exactMap[lower]) {
    return exactMap[lower];
  }

  return cleaned
    .split(" ")
    .map((word) => {
      if (word === "wifi") return "Wi-Fi";
      if (word === "tv") return "TV";
      if (word === "ac") return "A/C";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function formatFacetLabel(facet: string): string {
  const exactMap: Record<string, string> = {
    check_in: "Check-in",
    check_out: "Check-out",
    amenities_breakfast: "Breakfast",
    amenities_parking: "Parking",
    amenities_pool: "Pool",
    know_before_you_go: "Know Before You Go",
  };
  return exactMap[facet] ?? facet.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatEvidenceSnippet(value: string): string {
  const text = normalizeText(value);
  if (!text) return "";

  const segments = text
    .split(/\s+\|\s+|;\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 4);

  const formatted = segments.map(formatEvidenceSegment).filter(Boolean).join(". ");
  return formatted ? `${formatted}${formatted.endsWith(".") ? "" : "."}` : "";
}

function formatEvidenceSegment(segment: string): string {
  const cleaned = segment.replace(/^[\["'\s]+|[\]"'\s]+$/g, "").trim();
  if (!cleaned) return "";

  const match = /^([a-z0-9_]+):\s*(.+)$/i.exec(cleaned);
  if (!match) {
    return sentenceCase(cleaned.replace(/_/g, " "));
  }

  const [, rawKey, rawValue] = match;
  const value = rawValue.replace(/_/g, " ").trim();

  const labelMap: Record<string, string | null> = {
    property_description: null,
    popular_amenities_list: "Popular amenities include",
    property_amenity_parking: "Parking includes",
    property_amenity_things_to_do: "Things to do include",
    check_in_start_time: "Check-in starts at",
    check_in_end_time: "Late check-in until",
    check_in_instructions: "Check-in details",
    check_out_time: "Check-out by",
    check_out_policy: "Check-out policy",
    know_before_you_go: null,
  };

  const label = labelMap[rawKey];
  if (label === null) {
    return sentenceCase(value);
  }
  if (label) {
    return `${label} ${value}`;
  }
  return `${humanizeFieldKey(rawKey)}: ${value}`;
}

function humanizeFieldKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
