import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexStore } from "../src/backend/convexStore.js";
import { seedRuntimeBundle, type RuntimeBundle } from "../src/backend/runtimeBundle.js";
import type { FacetClassifierArtifact } from "../src/backend/ml.js";

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
