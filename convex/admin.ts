import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

import { createConvexStore } from "../src/backend/convexStore.js";
import { seedRuntimeBundle, type RuntimeBundle } from "../src/backend/runtimeBundle.js";

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
