# Repository Pack

This file is a compact markdown snapshot of the repository: what is here, what each major area does, and where to start reading.

## One-Line Summary

ReviewGap is a Next.js + Convex application that helps travelers write more useful hotel reviews by asking targeted follow-up questions, extracting structured facts, and saving an enhanced final review back into a live property evidence system.

## Top-Level Structure

```text
WhartonHackathon/
├── app/
├── convex/
├── src/
│   ├── backend/
│   └── lib/
├── EDA/
├── scripts/
├── tests/
├── package.json
├── README.md
└── AGENTS.md
```

## Directory Guide

### `app/`

Frontend built with the Next.js App Router.

- `app/page.tsx`
  Main product experience: landing page, property browser, chat flow, review drafting, fact confirmation, and final submission.
- `app/providers.tsx`
  App-wide client providers.
- `app/api/transcribe/route.ts`
  Server route for uploaded audio transcription.
- `app/api/realtime-session/route.ts`
  Server route that creates short-lived realtime client secrets for live audio sessions.

### `convex/`

Backend schema and server entry points.

- `convex/schema.ts`
  Database schema for properties, facet metrics, evidence, review sessions, user reviews, live signals, and ML artifacts.
- `convex/reviewGapPublic.ts`
  Public queries and mutations for listing properties, reading detail pages, listing reviews, and creating sessions.
- `convex/reviewGapActions.ts`
  Authenticated action flow for selecting follow-ups, generating previews, and confirming enhanced reviews.
- `convex/reviewGap.ts`
  Alternate public API surface for session analysis and follow-up handling.
- `convex/reviewGapInternal.ts`
  Internal helpers used across Convex functions.
- `convex/actionStore.ts`
  Convex action-side store helpers and runtime artifact loading.
- `convex/admin.ts`
  Admin-oriented server utilities.
- `convex/auth.config.ts`
  Convex auth provider configuration for Clerk / JWT auth.

### `src/backend/`

Core product logic.

- `service.ts`
  End-to-end orchestration of sessions: create session, analyze review, pick next question, extract facts, generate preview, confirm save.
- `ai.ts`
  OpenAI-backed client plus fallback wrappers for analysis, question generation, fact extraction, and final review drafting.
- `fallbacks.ts`
  Deterministic fallback logic when LLM services are unavailable.
- `ml.ts`
  TF-IDF facet classifier runtime and prediction logic.
- `ranker.ts`
  Learned ranker scoring helpers.
- `scoring.ts`
  Heuristic facet scoring, live-signal blending, and ranking logic.
- `propertySource.ts`
  Builds property evidence, live review samples, and source-aware facet signals from imported review data.
- `liveValidation.ts`
  Imports source snapshots and recomputes runtime validation state.
- `convexStore.ts`
  Store adapter that maps service-layer operations to Convex reads and writes.
- `whyThisQuestion.ts`
  Generates provenance text explaining why a question was selected.
- `types.ts`
  Shared domain types and artifact contracts.
- `facets.ts`
  Canonical runtime facet definitions and policies.
- `runtimeBundle.ts`
  Runtime bundle helpers for artifact-backed configuration.

### `src/lib/`

Frontend utility code.

- `audio.ts`
  Audio file helpers.
- `realtimeAudio.ts`
  Realtime audio constants and PCM conversion helpers.
- `reviewPreview.ts`
  Payload normalization for review preview responses.

### `EDA/`

Research, analysis, and offline ML pipeline.

- `EDA/README.md`
  Overview of the data-science work and key findings.
- `EDA/findings/`
  Written findings about coverage gaps, staleness, conflicts, semantic analysis, and ML feasibility.
- `EDA/scripts/`
  Python scripts for EDA, classifier training, ranker training, evaluation, and artifact generation.
- `EDA/data_artifacts/runtime/`
  Runtime JSON artifacts consumed by the app, including the review classifier and learned ranker.
- `EDA/charts/`
  Visual outputs used to support the product and hackathon story.

### `scripts/`

Operational scripts for local development and demos.

- `seed-demo.mjs`
  Seeds the app with demo runtime artifacts.
- `seed-source-data.mjs`
  Seeds source property/review data.
- `refresh-source-runtime.mjs`
  Recomputes runtime records from source data.
- `live-review-demo.ts`
  Scripted live demo flow.
- `scrape_expedia_subset.py`
  Data collection helper.

### `tests/`

Unit and integration-style coverage for important subsystems.

- `service.test.ts`
- `ml.test.ts`
- `scoring.test.ts`
- `liveValidation.test.ts`
- `propertySource.test.ts`
- `runtimeBundle.test.ts`
- `audio.test.ts`
- `realtimeAudio.test.ts`
- `reviewPreview.test.ts`

## Main Product Flow

```text
Traveler picks property
→ starts a review session
→ writes a draft review
→ system analyzes mentioned / likely-known facets
→ ranker selects the next best follow-up question
→ traveler answers
→ system extracts facts + generates preview
→ traveler confirms or edits
→ enhanced review is saved
→ first-party review feeds back into live property signals
```

## ML + Intelligence Layers

### Runtime ML

- TF-IDF facet classifier for draft-review topic detection
- learned linear / tree ranker artifact support
- heuristic fallback scorer for reliable serving

### LLM-Assisted Features

- review analysis
- follow-up phrasing
- fact extraction from answers
- polished final-review generation
- audio transcription and realtime session support

### Deterministic Safety Nets

- conservative fallbacks when OpenAI is not configured
- strict follow-up limits
- editable fact confirmation before save

## Commands

```bash
pnpm dev
pnpm run dev:web
pnpm run dev:convex
pnpm run seed:demo
pnpm run seed:source
pnpm run refresh:source-runtime
pnpm run build
pnpm run typecheck
pnpm test
pnpm run check
```

## Artifact Pipeline

The offline pipeline produces app-consumable artifacts such as:

- `EDA/data_artifacts/runtime/review_classifier_artifact.json`
- `EDA/data_artifacts/runtime/learned_ranker_artifact.json`
- `EDA/data_artifacts/runtime/reviewgap_runtime_bundle.json`

These are seeded into Convex for the live demo experience.

## Best Entry Points

If you are reading the code for the first time, start here:

1. `README.md`
2. `app/page.tsx`
3. `convex/reviewGapPublic.ts`
4. `convex/reviewGapActions.ts`
5. `src/backend/service.ts`
6. `src/backend/scoring.ts`
7. `src/backend/ml.ts`
8. `EDA/README.md`
