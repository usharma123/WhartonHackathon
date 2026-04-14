# ReviewGap Backend Scaffold

TypeScript-first backend scaffold for the hackathon MVP:

- runtime contract in TypeScript
- Convex schema and import/query/mutation wrappers
- offline Python artifact export
- deterministic facet ranking with bounded AI fallback points

## Stack

- `pnpm`
- TypeScript
- Convex
- OpenAI client wrapper
- Python EDA export step

## Repo Layout

- [src/backend](/Users/utsavsharma/Documents/GitHub/hack-ai-thon-submission-dream-team/src/backend) shared runtime logic, ranking, fallbacks, store adapters
- [convex](/Users/utsavsharma/Documents/GitHub/hack-ai-thon-submission-dream-team/convex) schema plus public backend contract wrappers
- [EDA/scripts/export_runtime_artifacts.py](/Users/utsavsharma/Documents/GitHub/hack-ai-thon-submission-dream-team/EDA/scripts/export_runtime_artifacts.py) offline export from validated EDA artifacts
- [EDA/data_artifacts/runtime/reviewgap_runtime_bundle.json](/Users/utsavsharma/Documents/GitHub/hack-ai-thon-submission-dream-team/EDA/data_artifacts/runtime/reviewgap_runtime_bundle.json) runtime seed bundle
- [tests](/Users/utsavsharma/Documents/GitHub/hack-ai-thon-submission-dream-team/tests) unit and session-flow coverage

## Commands

```bash
pnpm install
pnpm run export:runtime
pnpm run build
pnpm test
pnpm run check
```

## What’s Implemented

- Convex tables for `properties`, `propertyFacetMetrics`, `propertyFacetEvidence`, `reviewSessions`, `followUpQuestions`, `followUpAnswers`, and append-only `propertyEvidenceUpdates`
- deterministic ranking policy with the MVP allow-list and hard-blocked facets
- fallback review analysis, question phrasing, and answer fact extraction
- runtime bundle export from:
  - `property_facet_freshness.csv`
  - `listing_review_drift_matched.csv`
  - `semantic_conflict_validated.csv`
  - `semantic_thresholds.csv`
- curated demo scenarios for:
  - check-in friction
  - breakfast mismatch
  - parking shortage/conflict

## Notes

- The shared backend service is fully testable today.
- The Convex wrappers currently use the deterministic fallback path inside the local scaffold. Wire a live `OpenAIReviewGapClient` into deployed Convex actions once the project is connected to a real Convex environment.
