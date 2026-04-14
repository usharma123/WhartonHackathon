import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { ConvexHttpClient } from "convex/browser";

const root = process.cwd();
const env = await loadEnv(root);
const url =
  env.CONVEX_URL ??
  env.NEXT_PUBLIC_CONVEX_URL ??
  process.env.CONVEX_URL ??
  process.env.NEXT_PUBLIC_CONVEX_URL;

if (!url) {
  throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL.");
}

const client = new ConvexHttpClient(url);
const dataset = await readSourceDataset(root);

const clearResult = await clearSourceDataset(client);
const propertyResult = await client.mutation("admin:importSourcePropertiesBatch", {
  properties: dataset.properties,
});

const reviewBatchSize = 250;
let importedReviews = 0;
for (let index = 0; index < dataset.reviews.length; index += reviewBatchSize) {
  const chunk = dataset.reviews.slice(index, index + reviewBatchSize);
  const result = await client.mutation("admin:importSourceReviewsBatch", {
    reviews: chunk,
  });
  importedReviews += result.importedReviews ?? chunk.length;
  console.log(
    `Imported ${importedReviews}/${dataset.reviews.length} reviews into sourceReviews`,
  );
}

console.log("Cleared source dataset:", clearResult);
console.log("Seeded source properties:", propertyResult);
console.log("Seeded source reviews:", { importedReviews });

async function readSourceDataset(cwd) {
  const python = await resolvePython(cwd);
  const script = path.join(cwd, "scripts", "read_source_dataset.py");
  const { stdout } = await runCommand(python, [script], cwd);
  return JSON.parse(stdout);
}

async function clearSourceDataset(client) {
  const batchSize = 256;
  let deletedProperties = 0;
  let deletedReviews = 0;

  while (true) {
    const result = await client.mutation("admin:clearSourceDatasetBatch", {
      limit: batchSize,
    });
    deletedProperties += result.deletedProperties ?? 0;
    deletedReviews += result.deletedReviews ?? 0;
    if (result.done) {
      return { deletedProperties, deletedReviews };
    }
  }
}

async function resolvePython(cwd) {
  const venvPython = path.join(cwd, ".venv", "bin", "python");
  try {
    await access(venvPython);
    return venvPython;
  } catch {
    return "python3";
  }
}

async function runCommand(command, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Command failed (${code}): ${command} ${args.join(" ")}\n${stderr}`.trim(),
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

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
