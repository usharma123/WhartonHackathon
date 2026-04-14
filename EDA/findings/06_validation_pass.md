# Finding 06 — Validation Pass

This pass was added after reviewing the original semantic EDA and finding that some implementation-facing claims were too strong. The goal here is not to maximize recall; it is to identify which semantic signals are robust enough to guide the MVP and which ones are still exploratory.

Reference artifacts:

- `data_artifacts/semantic_threshold_sweep.csv`
- `data_artifacts/semantic_thresholds.csv`
- `data_artifacts/semantic_audit_samples.csv`
- `data_artifacts/listing_review_drift_matched.csv`
- `data_artifacts/semantic_conflict_validated.csv`
- `charts/17_listing_review_drift_matched_heatmap.png`
- `charts/18_semantic_thresholds.png`

## 1. Conservative thresholds are necessary

The original semantic pass used a global `0.35` cosine threshold. Audit samples showed that this is too permissive for several facets, especially `pet`, `children_extra_bed`, and parts of `know_before_you_go`.

Selected thresholds after the validation pass:

| Facet | Selected threshold |
|---|---|
| pet | 0.45 |
| check_in | 0.45 |
| check_out | 0.40 |
| amenities_pool | 0.45 |
| amenities_wifi | 0.40 |
| amenities_breakfast | 0.40 |
| amenities_parking | 0.45 |
| amenities_gym | 0.40 |
| children_extra_bed | 0.45 |
| know_before_you_go | 0.40 |

These thresholds are intentionally precision-oriented. They leave recall on the table, but they avoid letting the semantic layer flood the scoring logic with weak matches.

## 2. Not every semantic facet is equally trustworthy

`semantic_audit_samples.csv` is the key artifact here. The borderline semantic-only hits show a clear split:

- **More reliable facets:** `check_in`, `check_out`, `amenities_breakfast`, `amenities_parking`
- **Mixed facets:** `amenities_wifi`, `know_before_you_go`, `amenities_pool`
- **Still noisy:** `pet`, `children_extra_bed`

Examples of failure modes:

- `pet` still picks up generic positive reviews near the threshold.
- `children_extra_bed` is too entangled with generic family/travel language.
- `know_before_you_go` often pulls in general complaint language unless the review contains explicit fee/noise/restriction evidence.

**Implementation takeaway:** use semantic detection first on `check_in`, `check_out`, `breakfast`, and `parking`. Treat `pet` and `children_extra_bed` as research tracks until there is labeled data or tighter prototypes.

## 3. Facet-matched drift is much more defensible than all-review drift

The original drift artifact compared listing facet text against **all** reviews for a property. That underestimates support because most reviews do not discuss every facet.

When the comparison is restricted to high-confidence facet matches:

- Average listing↔review cosine rises from **0.25** to **0.33**
- The weakest matched-support facets remain:

| Facet | Mean cosine on all reviews | Mean cosine on facet-matched reviews |
|---|---|---|
| know_before_you_go | 0.22 | 0.29 |
| pet | 0.18 | 0.31 |
| amenities_pool | 0.27 | 0.31 |
| amenities_gym | 0.23 | 0.32 |
| check_out | 0.20 | 0.32 |

The key point is not that these facets are “wrong”; it is that **even among the subset of reviews that likely discuss them, support is still weak**. That makes them legitimate candidates for follow-up questions.

## 4. Raw anti-claim ranking is exploratory; validated conflict ranking is selective

The original `semantic_conflict_top.csv` is useful for qualitative demos, but it includes false positives because semantic proximity alone is not enough. The validation pass adds two filters:

1. The review must clear the stricter facet threshold.
2. The review must contain explicit negative evidence for that facet.

After filtering, the validated conflict artifact contains **90 rows**, concentrated on:

| Facet | Validated rows |
|---|---|
| know_before_you_go | 25 |
| check_in | 16 |
| amenities_breakfast | 15 |
| check_out | 15 |
| amenities_parking | 7 |
| amenities_pool | 5 |
| amenities_gym | 2 |
| amenities_wifi | 2 |
| pet | 2 |
| children_extra_bed | 1 |

This is a useful result in itself. It shows that semantic conflict mining is currently strongest for:

- hidden-fee / noise / restriction issues
- check-in / check-out friction
- breakfast mismatch
- parking mismatch

And it is still weak for:

- pet
- children / extra bed

## 5. Temporal drift is still a hint, not ground truth

The top three drifted properties remain the same, but the latest-quarter sample sizes are still small (`n_last = 3`, `5`, and `8`). That means drift is valuable as a prioritization feature, but it should not be used on its own to claim that a listing is stale.

## 6. What survived the validation pass

Safe to use in the MVP:

1. Lexical coverage gaps and staleness.
2. Semantic support for `check_in`, `check_out`, `breakfast`, and `parking`.
3. Facet-matched drift as a ranking input.
4. Validated semantic conflicts as curated evidence for demos and product seeding.

Not safe to over-claim yet:

1. Raw anti-claim nearest neighbors as “proof”.
2. Global `0.35` semantic threshold.
3. `pet` and `children_extra_bed` semantic matches as if they were clean labels.
4. Temporal drift as a standalone freshness verdict.
