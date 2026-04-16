import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexStore } from "../src/backend/convexStore.js";
import { seedRuntimeBundle, type RuntimeBundle } from "../src/backend/runtimeBundle.js";
import type { FacetClassifierArtifact } from "../src/backend/ml.js";
import { importExpediaPropertySnapshot } from "../src/backend/liveValidation.js";
import type { ImportedExpediaPropertySnapshot, LearnedRankerArtifact } from "../src/backend/types.js";

export const importRuntimeBundle = mutationGeneric({
  args: {
    bundle: v.any(),
  },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    await seedRuntimeBundle(store, args.bundle as RuntimeBundle);
    return {
      importedProperties: args.bundle.properties?.length ?? 0,
      importedMetrics: args.bundle.propertyFacetMetrics?.length ?? 0,
      importedEvidence: args.bundle.propertyFacetEvidence?.length ?? 0,
    };
  },
});

export const importFacetClassifierArtifact = mutationGeneric({
  args: {
    artifact: v.any(),
  },
  handler: async (ctx, args) => {
    const artifact = normalizeFacetClassifierArtifact(args.artifact);
    const existing = await ctx.db
      .query("mlRuntimeArtifacts")
      .withIndex("by_artifact_type", (q) => q.eq("artifactType", "facet_classifier"))
      .unique();
    const payload = {
      artifactType: artifact.artifactType,
      version: artifact.version,
      generatedAt: artifact.generatedAt,
      tokenizer: {
        regex: artifact.tokenizer.regex,
        minTokenLength: artifact.tokenizer.minTokenLength,
        ngramRange: artifact.tokenizer.ngramRange,
        lowercase: artifact.tokenizer.lowercase,
        stripAccents: artifact.tokenizer.stripAccents,
        l2Normalize: artifact.tokenizer.l2Normalize,
      },
      runtimeFacets: artifact.runtimeFacets,
      vocabularyEntries: Object.entries(artifact.vocabulary).map(([term, index]) => ({
        term,
        index,
      })),
      terms: artifact.terms,
      idf: artifact.idf,
      models: artifact.models,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("mlRuntimeArtifacts", payload);
    }
    return {
      artifactType: artifact.artifactType,
      version: artifact.version,
      runtimeFacets: artifact.runtimeFacets.length,
      vocabularySize: artifact.terms.length,
    };
  },
});

export const importExpediaSubset = mutationGeneric({
  args: {
    properties: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const store = createConvexStore(ctx.db);
    const classifierDoc = await ctx.db
      .query("mlRuntimeArtifacts")
      .withIndex("by_artifact_type", (q) => q.eq("artifactType", "facet_classifier"))
      .unique();
    const classifierArtifact = classifierDoc
      ? normalizeFacetClassifierArtifact(classifierDoc)
      : undefined;

    let imported = 0;
    for (const raw of args.properties) {
      await importExpediaPropertySnapshot(
        store,
        raw as ImportedExpediaPropertySnapshot,
        classifierArtifact,
      );
      imported += 1;
    }
    return {
      importedProperties: imported,
    };
  },
});

export const importLearnedRankerArtifact = mutationGeneric({
  args: {
    artifact: v.any(),
  },
  handler: async (ctx, args) => {
    const artifact = normalizeLearnedRankerArtifact(args.artifact);
    const existing = await ctx.db
      .query("learnedRankerArtifacts")
      .withIndex("by_artifact_type", (q) => q.eq("artifactType", "learned_ranker"))
      .unique();
    const payload = {
      artifactType: artifact.artifactType,
      version: artifact.version,
      generatedAt: artifact.generatedAt,
      modelKind: artifact.modelKind,
      featureKeys: artifact.featureKeys,
      featureStats: artifact.modelKind === "linear" ? artifact.featureStats : undefined,
      coefficients: artifact.modelKind === "linear" ? artifact.coefficients : undefined,
      intercept: artifact.modelKind === "linear" ? artifact.intercept : undefined,
      treePayloadJson: artifact.modelKind === "tree" ? artifact.treePayloadJson : undefined,
      temporalMetricsJson: artifact.temporalMetrics
        ? JSON.stringify(artifact.temporalMetrics)
        : undefined,
      manualMetricsJson: artifact.manualMetrics
        ? JSON.stringify(artifact.manualMetrics)
        : undefined,
      notes: artifact.notes,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("learnedRankerArtifacts", payload);
    }
    return {
      artifactType: artifact.artifactType,
      version: artifact.version,
      modelKind: artifact.modelKind,
      featureCount: artifact.featureKeys.length,
    };
  },
});

export const clearSourceDataset = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const [properties, reviews] = await Promise.all([
      ctx.db.query("sourceProperties").collect(),
      ctx.db.query("sourceReviews").collect(),
    ]);
    for (const doc of properties) {
      await ctx.db.delete(doc._id);
    }
    for (const doc of reviews) {
      await ctx.db.delete(doc._id);
    }
    return {
      deletedProperties: properties.length,
      deletedReviews: reviews.length,
    };
  },
});

export const clearSourceDatasetBatch = mutationGeneric({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const [properties, reviews] = await Promise.all([
      ctx.db.query("sourceProperties").take(args.limit),
      ctx.db.query("sourceReviews").take(args.limit),
    ]);
    for (const doc of properties) {
      await ctx.db.delete(doc._id);
    }
    for (const doc of reviews) {
      await ctx.db.delete(doc._id);
    }
    return {
      deletedProperties: properties.length,
      deletedReviews: reviews.length,
      done: properties.length === 0 && reviews.length === 0,
    };
  },
});

export const importSourcePropertiesBatch = mutationGeneric({
  args: {
    properties: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    for (const property of args.properties) {
      await ctx.db.insert("sourceProperties", property);
    }
    return {
      importedProperties: args.properties.length,
    };
  },
});

export const importSourceReviewsBatch = mutationGeneric({
  args: {
    reviews: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    for (const review of args.reviews) {
      await ctx.db.insert("sourceReviews", review);
    }
    return {
      importedReviews: args.reviews.length,
    };
  },
});

function normalizeFacetClassifierArtifact(raw: any): FacetClassifierArtifact {
  if (raw?.vocabulary && typeof raw.vocabulary === "object") {
    return raw as FacetClassifierArtifact;
  }

  const vocabularyEntries = Array.isArray(raw?.vocabularyEntries)
    ? raw.vocabularyEntries
    : [];

  return {
    artifactType: raw.artifactType,
    version: raw.version,
    generatedAt: raw.generatedAt,
    tokenizer: raw.tokenizer,
    runtimeFacets: raw.runtimeFacets,
    vocabulary: Object.fromEntries(
      vocabularyEntries.map((entry: { term: string; index: number }) => [entry.term, entry.index]),
    ),
    terms: raw.terms,
    idf: raw.idf,
    models: raw.models,
  } satisfies FacetClassifierArtifact;
}

function normalizeLearnedRankerArtifact(raw: any): LearnedRankerArtifact {
  if (raw?.artifactType === "learned_ranker" && raw?.modelKind === "tree") {
    return {
      artifactType: "learned_ranker",
      version: raw.version,
      generatedAt: raw.generatedAt,
      modelKind: "tree",
      featureKeys: raw.featureKeys ?? [],
      temporalMetrics: raw.temporalMetrics,
      manualMetrics: raw.manualMetrics,
      treePayloadJson: raw.treePayloadJson,
      notes: raw.notes ?? [],
    };
  }

  return {
    artifactType: "learned_ranker",
    version: raw.version,
    generatedAt: raw.generatedAt,
    modelKind: "linear",
    featureKeys: raw.featureKeys ?? [],
    featureStats: raw.featureStats ?? [],
    coefficients: raw.coefficients ?? [],
    intercept: raw.intercept ?? 0,
    temporalMetrics: raw.temporalMetrics,
    manualMetrics: raw.manualMetrics,
    notes: raw.notes ?? [],
  };
}
