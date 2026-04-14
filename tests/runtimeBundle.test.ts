import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadRuntimeBundle, seedRuntimeBundle } from "../src/backend/runtimeBundle.js";
import { InMemoryReviewGapStore } from "../src/backend/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(
  root,
  "EDA",
  "data_artifacts",
  "runtime",
  "reviewgap_runtime_bundle.json",
);

describe("runtime bundle export", () => {
  it("exports a runtime-ready bundle from the python pipeline", async () => {
    execFileSync("python3", ["EDA/scripts/export_runtime_artifacts.py"], {
      cwd: root,
      stdio: "pipe",
    });

    const bundle = await loadRuntimeBundle(bundlePath);
    expect(bundle.generatedAt).toBe("2026-04-13");
    expect(bundle.properties.length).toBe(13);
    expect(bundle.propertyFacetMetrics.length).toBe(130);
    expect(bundle.propertyFacetEvidence.length).toBeGreaterThan(0);
  });

  it("keeps one metric row per property facet", async () => {
    const bundle = await loadRuntimeBundle(bundlePath);
    const keys = bundle.propertyFacetMetrics.map(
      (metric) => `${metric.propertyId}:${metric.facet}`,
    );
    expect(new Set(keys).size).toBe(bundle.propertyFacetMetrics.length);
  });

  it("seeds idempotently into the in-memory store", async () => {
    const bundle = await loadRuntimeBundle(bundlePath);
    const store = new InMemoryReviewGapStore();
    await seedRuntimeBundle(store, bundle);
    await seedRuntimeBundle(store, bundle);

    const property = await store.getProperty(bundle.properties[0]!.propertyId);
    const metrics = await store.listPropertyFacetMetrics(bundle.properties[0]!.propertyId);
    const evidence = await store.listPropertyFacetEvidence(bundle.properties[0]!.propertyId);

    expect(property).not.toBeNull();
    expect(metrics.length).toBe(10);
    expect(new Set(evidence.map((item) => item.snippet)).size).toBe(evidence.length);
  });
});
