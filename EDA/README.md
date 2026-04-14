# ReviewGap — Exploratory Data Analysis

Self-contained EDA for the ReviewGap project. Regenerate everything with:

```bash
uv venv .venv && uv pip install --python .venv/bin/python \
    pandas numpy matplotlib pyarrow openai scikit-learn python-dotenv
.venv/bin/python EDA/scripts/run_eda.py           # lexical pass
.venv/bin/python EDA/scripts/semantic_eda.py      # semantic pass (cached)
```

Two passes. The **lexical** pass is fast and deterministic. The **semantic** pass embeds reviews with `text-embedding-3-small` (OpenAI key read from `.env`) and caches under `data_artifacts/embeddings/` so re-runs cost nothing.

## The 7 things worth knowing

1. **No lexical MVP facet is mentioned in more than 8.7% of reviews.** Travelers write about experience, not listing facts. The coverage gap remains the core product opportunity.
2. **Semantic detection is directionally better than regex, but only with conservative thresholds.** Raw embedding scores recover 2× to 14× more hits, but audit samples show that permissive thresholds over-fire on `pet` and `children_extra_bed`. Use `semantic_thresholds.csv` and `semantic_audit_samples.csv`, not the raw 0.35 cutoff, for implementation-facing decisions. (Findings 05, 06)
3. **All-review listing drift is too blunt; facet-matched drift is the useful signal.** Mean listing↔review cosine is 0.25 across all reviews, but rises to 0.33 when restricted to high-confidence facet matches. Lowest matched support remains on `know_before_you_go` (0.29), `pet` (0.31), `amenities_pool` (0.31), `amenities_gym` (0.32), and `check_out` (0.32). (Finding 06)
4. **Raw anti-claim probing is exploratory; validated conflicts are selective.** `semantic_conflict_top.csv` is still good for hypothesis generation, but only `semantic_conflict_validated.csv` should be treated as implementation-grade evidence. The cleanest semantic conflict signals are on `parking`, `check_in`, `check_out`, `breakfast`, and some `know_before_you_go` cases. (Finding 06)
5. **Temporal drift is real but sample-limited.** Three properties still show >14% first-quarter vs last-quarter drift, but the latest-quarter sample can be as small as 3 reviews. Use drift as a prioritization hint, not as a standalone truth signal.
6. **Multilingual clusters exist in the corpus** (Spanish, German, and some other non-English reviews). Regex misses much of this; embeddings recover part of it. **Multilingual support is still necessary.**
7. **92.7% of review titles are empty.** That makes the title-area follow-up plausible as a low-friction UI surface, though this is a product inference rather than a direct data finding.

## Charts

| # | File | What it shows |
|---|---|---|
| 01 | `charts/01_review_volume_over_time.png` | Monthly review volume per property (Feb 2023 → Feb 2026) |
| 02 | `charts/02_reviews_per_property.png` | 8 → 1,094 reviews per property (log scale) |
| 03 | `charts/03_review_length_distribution.png` | Text & title length distributions |
| 04 | `charts/04_overall_rating_distribution.png` | 1–5 star breakdown |
| 05 | `charts/05_rating_subdimension_coverage.png` | How often each of 15 sub-dims is filled |
| 06 | `charts/06_facet_mention_rates.png` | **Coverage gap chart — the core finding** |
| 07 | `charts/07_facet_staleness_heatmap.png` | Days-since-last-mention, property × facet |
| 08 | `charts/08_sentiment_vs_rating_conflict.png` | Conflict candidates |
| 09 | `charts/09_topic_coverage_by_property.png` | Per-property facet fingerprint |
| 10 | `charts/10_empty_title_rate.png` | 92.7% empty title rate |
| 11 | `charts/11_lexical_vs_semantic_facet.png` | **Regex vs embedding facet detection — the upgrade chart** |
| 12 | `charts/12_listing_review_drift_heatmap.png` | Listing↔review semantic cosine per property × facet |
| 13 | `charts/13_review_clusters_pca.png` | KMeans topic clusters in PCA 2D |
| 14 | `charts/14_temporal_drift.png` | Per-property embedding drift from 2023Q1 to latest |
| 15 | `charts/15_redundancy_per_property.png` | Review echo-chamber score |
| 16 | `charts/16_semantic_score_distributions.png` | Bimodal distributions that justify the semantic threshold |
| 17 | `charts/17_listing_review_drift_matched_heatmap.png` | Listing↔facet-matched-review cosine per property × facet |
| 18 | `charts/18_semantic_thresholds.png` | Conservative facet thresholds chosen for audit-grade precision |
| 19 | `charts/19_ml_binary_feasibility.png` | ROC AUC for low-rating detection under random, grouped, and temporal splits |
| 20 | `charts/20_ml_regression_feasibility.png` | MAE for exact-star prediction under random, grouped, and temporal splits |

## Data artifacts (reusable by the backend)

| File | Contents |
|---|---|
| `data_artifacts/facet_mentions.parquet` | 5,999 rows × 14 facet columns (binary hit matrix) |
| `data_artifacts/property_facet_freshness.csv` | Per (property × facet): last_mention_date, days_since, mention_rate |
| `data_artifacts/conflict_candidates.csv` | Property × facet pairs flagged by beta-binomial conflict posterior |
| `data_artifacts/summary.json` | Headline numbers for the pitch deck |
| `data_artifacts/semantic_facet_scores.csv` | Per-review cosine to every facet prototype (CSV fallback for environments without parquet support) |
| `data_artifacts/lexical_vs_semantic.csv` | Agreement matrix regex vs embeddings |
| `data_artifacts/semantic_threshold_sweep.csv` | Threshold sensitivity sweep per facet |
| `data_artifacts/semantic_thresholds.csv` | Selected conservative threshold per facet |
| `data_artifacts/semantic_audit_samples.csv` | Borderline semantic-only and lexical-only samples for manual review |
| `data_artifacts/listing_review_drift.csv` | Listing↔review cosine per (property, facet) |
| `data_artifacts/listing_review_drift_matched.csv` | Listing↔facet-matched-review cosine per (property, facet) |
| `data_artifacts/semantic_conflict_top.csv` | Top reviews that contradict listing claims |
| `data_artifacts/semantic_conflict_validated.csv` | Conflict candidates filtered to explicit negative evidence |
| `data_artifacts/temporal_drift.csv` | First-quarter vs last-quarter centroid cosine per property |
| `data_artifacts/redundancy_per_property.csv` | Mean pairwise cosine per property |
| `data_artifacts/ml_feasibility_metrics.csv` | Baseline vs TF-IDF model performance for rating prediction tasks |
| `data_artifacts/ml_feasibility_summary.json` | Compact summary of which ML tasks are worth pursuing |
| `data_artifacts/topic_clusters.json` | 14 KMeans clusters with nearest-to-centroid snippets |
| `data_artifacts/embeddings/` | Cached embedding .npy files — re-runs cost $0 |
| `data_artifacts/semantic_summary.json` | Headline semantic numbers |

## Findings docs

- [`findings/01_coverage_gaps.md`](findings/01_coverage_gaps.md) — where the holes are.
- [`findings/02_staleness_signals.md`](findings/02_staleness_signals.md) — how old the data is, per facet.
- [`findings/03_conflict_signals.md`](findings/03_conflict_signals.md) — where reviews disagree with listings.
- [`findings/04_algorithm_recommendations.md`](findings/04_algorithm_recommendations.md) — **the spec the MVP team implements** (Tier A rule engine + Tier B ML + Tier C LLM + Tier D hybrid), now with semantic terms.
- [`findings/05_semantic_analysis.md`](findings/05_semantic_analysis.md) — **embedding-based findings**: lexical vs semantic, listing drift, anti-claim conflict discovery, topic clusters, temporal drift, redundancy.
- [`findings/06_validation_pass.md`](findings/06_validation_pass.md) — what survived the validation pass, what stayed noisy, and which semantic signals are safe to productize.
- [`findings/07_ml_feasibility.md`](findings/07_ml_feasibility.md) — whether supervised ML is worth pursuing with the current dataset, and for which layer of the product.

## Bottom line

The data is still a strong fit for ReviewGap: lexical coverage is low, staleness is pervasive, and there are several validated listing-vs-review gaps. The stricter semantic pass also showed where not to over-claim: some facets are ready for prioritization support (`check_in`, `check_out`, `breakfast`, `parking`), while others (`pet`, `children_extra_bed`) need labeled data or tighter rules before they should drive product logic.

Recommended stack for the product demo: **Python FastAPI backend + Next.js TS frontend + GPT-4o-mini** — rationale in `findings/04_algorithm_recommendations.md`.
