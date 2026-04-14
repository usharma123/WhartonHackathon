import { readFile } from "node:fs/promises";
import path from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const root = process.cwd();
const env = await loadEnv(root);
const url =
  env.CONVEX_URL ??
  env.NEXT_PUBLIC_CONVEX_URL ??
  process.env.CONVEX_URL ??
  process.env.NEXT_PUBLIC_CONVEX_URL;

if (!url) {
  throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL. Start `convex dev --local` first.");
}

const artifactPath = resolveArg("--artifact") ?? path.join(root, "data", "expedia_subset_artifact.json");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const properties = Array.isArray(artifact.properties) ? artifact.properties : [];

if (properties.length === 0) {
  throw new Error(`No properties found in ${artifactPath}`);
}

const client = new ConvexHttpClient(url);
const chunkSize = 10;
let imported = 0;

for (let index = 0; index < properties.length; index += chunkSize) {
  const chunk = properties.slice(index, index + chunkSize);
  const result = await client.mutation(api.admin.importExpediaSubset, { properties: chunk });
  imported += result.importedProperties ?? chunk.length;
  console.log(
    `Imported chunk ${Math.floor(index / chunkSize) + 1}/${Math.ceil(properties.length / chunkSize)} ` +
      `(${chunk.length} properties)`,
  );
}

console.log(
  JSON.stringify(
    {
      artifactPath,
      requestedCount: artifact.requestedCount ?? properties.length,
      successfulCount: artifact.successfulCount ?? properties.length,
      reviewExtractionCount: artifact.reviewExtractionCount ?? 0,
      importedProperties: imported,
    },
    null,
    2,
  ),
);

function resolveArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function loadEnv(cwd: string) {
  const envFiles = [".env.local", ".env"];
  const values: Record<string, string> = {};
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
