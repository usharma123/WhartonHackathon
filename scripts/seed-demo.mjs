import { readFile } from "node:fs/promises";
import path from "node:path";

import { ConvexHttpClient } from "convex/browser";

const root = process.cwd();
const env = await loadEnv(root);
const url = env.CONVEX_URL ?? env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

if (!url) {
  throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL. Start `convex dev --local` first.");
}

const client = new ConvexHttpClient(url);

const runtimeBundle = JSON.parse(
  await readFile(
    path.join(root, "EDA", "data_artifacts", "runtime", "reviewgap_runtime_bundle.json"),
    "utf8",
  ),
);
const classifierArtifact = JSON.parse(
  await readFile(
    path.join(root, "EDA", "data_artifacts", "runtime", "review_classifier_artifact.json"),
    "utf8",
  ),
);

const runtimeResult = await client.mutation("admin:importRuntimeBundle", {
  bundle: runtimeBundle,
});
const classifierResult = await client.mutation("admin:importFacetClassifierArtifact", {
  artifact: classifierArtifact,
});

console.log("Seeded runtime bundle:", runtimeResult);
console.log("Seeded classifier artifact:", classifierResult);

async function loadEnv(cwd) {
  const envFiles = [".env.local", ".env"];
  const values = {};
  for (const file of envFiles) {
    const envPath = path.join(cwd, file);
    try {
      const content = await readFile(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
          continue;
        }
        const [key, ...rest] = trimmed.split("=");
        values[key] = rest.join("=");
      }
    } catch {
      // ignore missing env files
    }
  }
  return values;
}
