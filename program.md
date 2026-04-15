# AutoResearch Program — ReviewGap ML & Rules Layer

Adapted from Andrej Karpathy's autoresearch "ratchet loop" (karpathy/autoresearch, March 2026).

The agent reads this file, modifies `EDA/scripts/experiment_config.py`, retrains,
evaluates, and commits only if `combined_score` improves. Changes that don't improve
are reverted with `git checkout EDA/scripts/experiment_config.py`.

---

## Architecture

```
data/Reviews_PROC.csv  ──┐
EDA/data_artifacts/      ├──► train_review_classifier.py  (uses experiment_config.py)
  semantic_facet_scores  ┘         │
  semantic_thresholds              ▼
                          review_classifier_artifact.json   ← TypeScript loads this at runtime
                          review_classifier_report.json     ← evaluate.py reads this
                                   │
                          export_runtime_artifacts.py  (uses experiment_config.py)
                                   │
                          reviewgap_runtime_bundle.json     ← TypeScript loads this at runtime
```

**ML layer** (offline Python → TypeScript runtime):
- sklearn TF-IDF + LogisticRegression, one binary classifier per facet
- Per-facet thresholds chosen by F1-optimal sweep at inference time
- Artifact loaded into Convex DB; inference runs in `src/backend/ml.ts`

**Rules layer** (offline Python → TypeScript runtime):
- Importance values, reliability thresholds, staleness normalization in `export_runtime_artifacts.py`
- Scoring weights live in `src/backend/scoring.ts` (update manually after finding a winner)

---

## The Ratchet Loop

```
1. Read program.md and the last 10 lines of EDA/data_artifacts/runtime/results.tsv
2. Read EDA/scripts/experiment_config.py
3. Form ONE hypothesis — why will this change improve combined_score?
4. Edit EDA/scripts/experiment_config.py with the change
5. Run:  python3 EDA/scripts/train_review_classifier.py
         python3 EDA/scripts/export_runtime_artifacts.py
6. Run:  python3 EDA/scripts/evaluate.py
         (prints combined_score and appends a row to results.tsv with kept=yes/no)
7. If combined_score improved →  git add EDA/scripts/experiment_config.py \
                                          EDA/data_artifacts/runtime/ && \
                                 git commit -m "ratchet: <hypothesis>"
   If NOT improved           →  revert the config change and rerun the baseline artifacts
8. Go to step 1
```

---

## What Can Be Changed

**ONLY modify `EDA/scripts/experiment_config.py`.**  Do not touch:
- `EDA/scripts/train_review_classifier.py` (immutable training harness)
- `EDA/scripts/export_runtime_artifacts.py` (immutable export harness)
- `EDA/scripts/evaluate.py` (immutable evaluation)

### Tunable Parameters in `EDA/scripts/experiment_config.py`

#### ML Training (train_review_classifier.py)
| Parameter | Default | Description |
|-----------|---------|-------------|
| `POSITIVE_MARGIN` | 0.05 | Semantic score must be threshold+margin to be a positive label |
| `NEGATIVE_MARGIN` | 0.05 | Semantic score must be threshold-margin to be a negative label |
| `MIN_TEXT_LEN` | 20 | Minimum character length of review text to include |
| `C` | 2.0 | Logistic regression regularization (lower = more regularization) |
| `MAX_FEATURES` | 2500 | TF-IDF vocabulary size |
| `MIN_DF` | 2 | Minimum document frequency for a term to be included |
| `NGRAM_RANGE` | (1, 2) | TF-IDF n-gram range |
| `CLASS_WEIGHT` | "balanced" | Class weighting for imbalanced labels; try None or dict |
| `MAX_ITER` | 1500 | Solver iteration limit |
| `CV_FOLDS` | 5 | Grouped CV folds for out-of-fold evaluation |

#### Shipping Gate (when a model is accepted)
| Parameter | Default | Description |
|-----------|---------|-------------|
| `PRIMARY_MIN_ROC_AUC` | 0.78 | Minimum ROC-AUC for primary facets |
| `PRIMARY_MIN_F1` | 0.52 | Minimum F1 for primary facets |
| `SECONDARY_MIN_ROC_AUC` | 0.72 | Minimum ROC-AUC for secondary facets |
| `SECONDARY_MIN_F1` | 0.42 | Minimum F1 for secondary facets |

#### Rules Layer — Importance Values (export_runtime_artifacts.py)
| Facet | Default |
|-------|---------|
| `check_in` | 0.95 |
| `check_out` | 0.84 |
| `amenities_breakfast` | 0.90 |
| `amenities_parking` | 0.92 |
| `know_before_you_go` | 0.70 |
| `amenities_pool` | 0.68 |

#### Rules Layer — Reliability Classification (export_runtime_artifacts.py)
| Parameter | Default | Description |
|-----------|---------|-------------|
| `RELIABILITY_HIGH_MATCHED_RATE` | 0.03 | matched_review_rate threshold for "high" class |
| `RELIABILITY_MEDIUM_COS` | 0.32 | mean cosine similarity threshold for "medium" class |
| `RELIABILITY_MEDIUM_MATCHED_RATE` | 0.01 | secondary matched_review_rate threshold for "medium" |
| `RELIABILITY_MEDIUM_MENTION_RATE` | 0.02 | mention_rate threshold for "medium" class |
| `STALENESS_NORM_DAYS` | 365 | days_since denominator for staleness normalization |

---

## Optimization Target

The evaluation metric is computed in `evaluate.py`:

```
weighted_f1  = mean of per-facet out-of-fold F1, weighted by facet importance
mean_roc_auc = mean of per-facet out-of-fold ROC-AUC
gate_rate    = fraction of facets that pass their shipping gate
ml_score     = 0.5 * weighted_f1 + 0.35 * mean_roc_auc + 0.15 * gate_rate

rules_score  = 0.4 * validated-conflict recall
             + 0.3 * top-1 ranking accuracy
             + 0.3 * reciprocal-rank quality

combined_score = 0.85 * ml_score + 0.15 * rules_score
```

**Keep a commit only if `combined_score` strictly exceeds the previous best.**

---

## Research Directions to Explore

### High-Priority (try first)

1. **Tighter positive margin**: `POSITIVE_MARGIN=0.10` narrows training to high-confidence
   positives — fewer noisy labels, potentially higher precision.

2. **Regularization sweep**: try `C=1.0`, `C=0.5`, `C=5.0`. The current default (2.0)
   may overfit on the smaller secondary-facet training sets.

3. **Larger vocabulary**: `MAX_FEATURES=4000` captures more hotel-specific bigrams
   (e.g. "front desk", "room key") without blowing up model size much.

4. **Raise MIN_TEXT_LEN**: short reviews are noisy. Try `MIN_TEXT_LEN=40`.

5. **Asymmetric margins**: primary facets (check_in, check_out, breakfast, parking)
   have large label sets — try `POSITIVE_MARGIN=0.08` for them and `0.05` for secondary.
   Implement this as per-facet margin dicts in experiment_config.py.

### Medium-Priority

6. **Relax shipping gate for secondary facets**: `SECONDARY_MIN_F1=0.38` may unlock
   more useful secondary classifiers that currently fail the gate.

7. **Importance rebalancing**: try nudging `amenities_parking` from 0.92 to 0.85
   (parking has very high base coverage) and `know_before_you_go` from 0.70 to 0.75.

8. **Reliability threshold tuning**: `RELIABILITY_HIGH_MATCHED_RATE=0.05` may reduce
   the number of "high" reliability facets and focus questions on genuinely uncertain ones.

9. **Staleness window**: `STALENESS_NORM_DAYS=180` doubles the sensitivity to stale data
   (90-day-old data scores 0.50 staleness instead of 0.25).

### Lower-Priority

10. **Trigrams**: `NGRAM_RANGE=(1,3)` with `MAX_FEATURES=5000` to capture phrases like
    "no hot water" or "pool was closed".

11. **min_df sweep**: try `MIN_DF=3` or `MIN_DF=1` to widen/narrow vocabulary.

---

## Results Log

`EDA/data_artifacts/runtime/results.tsv` — one row per experiment:
```
timestamp	hypothesis	weighted_f1	mean_roc_auc	gate_rate	combined_score	kept
```

`evaluate.py` appends a row automatically and sets `kept=yes` or `kept=no`.

---

## After Finding a Winner

Once a config improves `combined_score` past the baseline:
- The retrained artifact in `EDA/data_artifacts/runtime/review_classifier_artifact.json`
  is ready to seed into Convex: `pnpm run seed:source`
- Importance values in `experiment_config.py` → copy to `export_runtime_artifacts.py IMPORTANCE`
  dict AND to `src/backend/facets.ts` (the `importance` field in each `FACET_POLICIES` entry)
- Run `pnpm run check` to confirm no TypeScript regressions
