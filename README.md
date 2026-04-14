# ReviewGap Demo Engine

Next.js + Convex demo for live review-aware follow-up questions, with deterministic ranking, persisted session state, and optional OpenAI-assisted phrasing/extraction.

## Stack

- `pnpm`
- `Next.js 15`
- `React 19`
- `Convex`
- `OpenAI`
- Python artifact export for offline ML/runtime bundle generation

## Convex Setup

The app expects `NEXT_PUBLIC_CONVEX_URL` to come from Convex rather than falling back to a hardcoded localhost URL.

### Local development

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs `convex dev --local` and starts `next dev` in the same flow. Convex will generate `.env.local` with `NEXT_PUBLIC_CONVEX_URL`.

### Seed the local Convex database

Once Convex is running and `.env.local` exists:

```bash
pnpm run seed:demo
```

This imports:

- the runtime bundle from `EDA/data_artifacts/runtime/reviewgap_runtime_bundle.json`
- the ML classifier artifact from `EDA/data_artifacts/runtime/review_classifier_artifact.json`

### Offline Expedia subset ingest

For a curated `25-50` property batch:

1. Copy `data/expedia_subset.example.json` to `data/expedia_subset.json` and fill in real Expedia hotel URLs.
2. Scrape and extract an artifact with Firecrawl + OpenAI:

```bash
pnpm run scrape:expedia -- --manifest data/expedia_subset.json --limit 25
```

3. Seed the extracted subset into Convex:

```bash
pnpm run seed:expedia -- --artifact data/expedia_subset_artifact.json
```

The scraper writes a success report into the artifact so you can decide whether to expand past the first batch.

### Optional OpenAI setup

Copy `.env.local.example` to `.env.local` only if you need to wire values manually, then set:

```bash
OPENAI_API_KEY=...
```

Without `OPENAI_API_KEY`, the app still runs using the deterministic fallback path where supported.

## Repo Layout

- `app` App Router UI and Convex client provider
- `convex` schema plus queries, mutations, and actions
- `src/backend` shared ranking, fallback, ML, and store logic
- `EDA/scripts` artifact export/build scripts
- `EDA/data_artifacts/runtime` runtime seed artifacts
- `tests` unit and session-flow coverage

## Commands

```bash
pnpm dev
pnpm run dev:web
pnpm run dev:convex
pnpm run seed:demo
pnpm run build
pnpm run typecheck
pnpm test
pnpm run check
```

## What’s Implemented

- Convex tables for `properties`, `propertyFacetMetrics`, `propertyFacetEvidence`, `reviewSessions`, `followUpQuestions`, `followUpAnswers`, and append-only `propertyEvidenceUpdates`
- React client integration via `ConvexProvider` and generated `api` bindings
- deterministic ranking policy with the MVP allow-list and hard-blocked facets
- OpenAI-backed review analysis, question phrasing, and answer fact extraction when `OPENAI_API_KEY` is configured
- fallback review analysis, question phrasing, and answer fact extraction when AI is unavailable
- curated demo scenarios for check-in friction, breakfast mismatch, and parking shortage/conflict
