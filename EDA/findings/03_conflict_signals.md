# Finding 03 — Conflict Signals

See `charts/08_sentiment_vs_rating_conflict.png` and `data_artifacts/conflict_candidates.csv`.

## Method
For each (property × facet) pair with ≥5 mentions:
1. Classify each mention as "negative-heavy" if it contains more negative than positive cue words.
2. Compute negative-mention share.
3. Beta-binomial posterior `P(neg_share > 30% | data)` with Beta(1,1) prior.

Cells with `P > 0.5` are **high-confidence conflict candidates**.

## Results
- **7 (property × facet) pairs** exceed the 0.5 posterior threshold.
- The worst offenders cluster on two properties and four facets: `know_before_you_go`, `check_out`, `pet`, `amenities_wifi`.

Top 5 (from `conflict_candidates.csv`):

| Property (prefix) | Facet | Mentions | Neg share | P(neg>30%) |
|---|---|---|---|---|
| 3216b1b7… | know_before_you_go | 48 | 37.5% | 0.89 |
| 7d027ef7… | check_out | 19 | 36.8% | 0.77 |
| 7d027ef7… | pet | 14 | 35.7% | 0.71 |
| 7d027ef7… | amenities_wifi | 17 | 35.3% | 0.70 |
| 3216b1b7… | check_out | 9 | 33.3% | 0.66 |

## Rating-text conflict (secondary signal)
Many reviews carry a 5★ `overall` rating but 1–2★ on a specific sub-dimension (e.g., `roomcleanliness`). When this pattern clusters at a property × facet level, it's a flag that the listing description is over-claiming.

## Why this matters for ReviewGap
Conflict cells are the **most valuable questions to ask**. A reviewer who just stayed there is positioned to resolve the dispute:
> "We've seen mixed reports on the Wi-Fi lately — was yours usable for work?"

The follow-up converts subjective complaints into structured evidence (boolean + freshness timestamp), which can then refresh the listing.
