import path from "node:path";
import { readFile } from "node:fs/promises";

import OpenAI from "openai";

import { OpenAIReviewGapClient } from "../src/backend/ai.js";
import { loadFacetClassifierArtifact } from "../src/backend/ml.js";
import { loadRuntimeBundle, seedRuntimeBundle } from "../src/backend/runtimeBundle.js";
import {
  analyzeDraftReview,
  createReviewSession,
  getSessionSummary,
  selectNextQuestion,
  submitFollowUpAnswer,
} from "../src/backend/service.js";
import { InMemoryReviewGapStore } from "../src/backend/store.js";

const runtimeBundlePath = path.join(
  process.cwd(),
  "EDA",
  "data_artifacts",
  "runtime",
  "reviewgap_runtime_bundle.json",
);
const classifierPath = path.join(
  process.cwd(),
  "EDA",
  "data_artifacts",
  "runtime",
  "review_classifier_artifact.json",
);

const CHECKIN_PROPERTY =
  "ff26cdda236b233f7c481f0e896814075ac6bed335e162e0ff01d5491343f838";
const draftReview =
  "The room was comfortable, but getting settled took forever because the desk kept saying the room still was not ready after arrival.";
const answerText =
  "Check-in was frustrating. We waited about 35 minutes, then finally got the keys around 4:10 pm.";

async function main() {
  await loadEnv(process.cwd());

  const store = new InMemoryReviewGapStore();
  const runtimeBundle = await loadRuntimeBundle(runtimeBundlePath);
  const classifierArtifact = await loadFacetClassifierArtifact(classifierPath);
  await seedRuntimeBundle(store, runtimeBundle);

  const aiClient = process.env.OPENAI_API_KEY
    ? new OpenAIReviewGapClient(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : undefined;

  const session = await createReviewSession(store, {
    propertyId: CHECKIN_PROPERTY,
    draftReview,
  });
  const analysis = await analyzeDraftReview(
    store,
    aiClient,
    { sessionId: session.sessionId, draftReview },
    classifierArtifact,
  );
  const question = await selectNextQuestion(
    store,
    aiClient,
    { sessionId: session.sessionId, draftReview },
    classifierArtifact,
  );
  const answer = await submitFollowUpAnswer(store, aiClient, {
    sessionId: session.sessionId,
    facet: question.facet ?? "check_in",
    answerText,
  });
  const summary = await getSessionSummary(store, session.sessionId);

  console.log(
    JSON.stringify(
      {
        session,
        analysis,
        question,
        answer,
        summary,
      },
      null,
      2,
    ),
  );
}

void main();

async function loadEnv(cwd: string) {
  for (const file of [".env.local", ".env"]) {
    const envPath = path.join(cwd, file);
    try {
      const content = await readFile(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
          continue;
        }
        const [rawKey, ...rest] = trimmed.split("=");
        const key = rawKey.trim();
        if (!key || process.env[key]) {
          continue;
        }
        const rawValue = rest.join("=").trim();
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // ignore missing env files
    }
  }
}
