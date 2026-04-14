# Finding 07 — ML Feasibility

This analysis asks a narrow question:

> With the labels we already have, is there enough signal in review text to justify pursuing supervised ML for ReviewGap?

The answer is **yes for coarse review understanding**, and **not yet for end-to-end facet/conflict supervision**.

Reference artifacts:

- `data_artifacts/ml_feasibility_metrics.csv`
- `data_artifacts/ml_feasibility_summary.json`
- `charts/19_ml_binary_feasibility.png`
- `charts/20_ml_regression_feasibility.png`

## 1. Setup

Only reviews with at least **20 characters** of text were used, because that is the realistic minimum for text-driven ML.

Usable supervised tasks from existing labels:

| Task | Label source | Rows | Negative share (`<=3`) |
|---|---|---:|---:|
| overall | `rating_overall` | 3,855 | 22.9% |
| cleanliness | `rating_roomcleanliness` | 3,705 | 16.4% |
| service | `rating_service` | 3,564 | 16.3% |
| ecofriendliness | `rating_ecofriendliness` | 1,564 | 23.5% |

Evaluations:

1. `random_cv` — optimistic upper bound
2. `group_property_cv` — generalization to unseen properties
3. `temporal_holdout_2025+` — generalization to future reviews

Models:

- baseline (`mean` or `majority`)
- `text_tfidf`
- `text_plus_property`

## 2. Binary low-rating detection is clearly learnable

Text-only ROC AUC under the hardest realistic split (`group_property_cv`):

| Task | ROC AUC | Avg Precision | F1 |
|---|---:|---:|---:|
| overall | 0.904 | 0.716 | 0.670 |
| service | 0.874 | 0.586 | 0.558 |
| cleanliness | 0.870 | 0.517 | 0.523 |
| ecofriendliness | 0.790 | 0.546 | 0.546 |

This is materially above the majority baseline on every task.

Interpretation:

- **Overall rating** is strongly learnable from text.
- **Service** and **cleanliness** are also good candidates for ML support.
- **Ecofriendliness** is weaker, but still useful enough to justify exploration.

## 3. Exact-star prediction is also viable

Text-only MAE under `group_property_cv`:

| Task | MAE |
|---|---:|
| service | 0.587 |
| overall | 0.600 |
| cleanliness | 0.601 |
| ecofriendliness | 0.681 |

These beat the mean baseline by **0.17 to 0.31 MAE**, depending on task.

On a 1–5 star scale, an MAE around **0.60** is strong enough to support ranking, prioritization, and score smoothing, even if it is not good enough to replace explicit user feedback.

## 4. Signal survives realistic generalization tests

This is the most important part of the study.

The strong scores are not just random-CV leakage:

- `overall` low-rating detection reaches **0.904 ROC AUC** on unseen properties.
- `overall` reaches **0.936 ROC AUC** on the 2025+ temporal holdout.
- `cleanliness` and `service` remain above **0.87 ROC AUC** on grouped CV.

That means the models are not merely memorizing a few properties or time periods. The text itself carries durable signal.

## 5. Property metadata adds little incremental value

`text_plus_property` is usually close to `text_tfidf`, and often slightly worse under grouped CV.

That is a good sign:

- the model is learning from the review content itself
- it is less dependent on property identity than expected
- the approach is more likely to transfer to new properties

## 6. Where ML is worth pursuing

Worth pursuing now:

1. **Low-rating / issue detection** from review text.
2. **Aspect-level quality estimation** for `service` and `cleanliness`.
3. **Ranking features** for which follow-up question to ask.
4. **Backfill or smoothing** for sparse structured scores where text exists.

Not worth pursuing yet as a supervised ML problem:

1. **Facet conflict prediction** from `semantic_conflict_validated.csv`.
   Current counts are too small: `25` for `know_before_you_go`, `16` for `check_in`, `15` for `check_out`, `15` for `breakfast`, and single digits elsewhere.
2. **Direct supervised models for `pet` or `children_extra_bed`**.
   The semantic validation pass already showed these are still noisy.
3. **A monolithic end-to-end “next best question” model**.
   There is no outcome label yet for whether a follow-up was answered, helpful, or corrected the listing.

## 7. Bottom line

If the question is:

> Is there enough signal to justify ML work on this product?

The answer is **yes**, but only for the right layer.

Recommended ML scope:

1. Use ML for **review understanding**: negative review detection, aspect inference, and score estimation.
2. Keep **question ranking** mostly rule-based for now, with ML-derived features feeding the rules.
3. Do **not** build a fully supervised facet/conflict model yet; the labels are too sparse.
4. If the team wants the next jump in quality, collect a small labeled set for:
   - `pet`
   - `children_extra_bed`
   - listing contradiction / confirmation

That would be the highest-ROI next dataset to create.
