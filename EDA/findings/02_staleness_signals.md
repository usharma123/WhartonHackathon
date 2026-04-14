# Finding 02 — Staleness Signals

Reference date: **2026-04-13**. See `charts/07_facet_staleness_heatmap.png` and `data_artifacts/property_facet_freshness.csv`.

## How many (property × facet) cells are stale?
Of 130 cells (13 properties × 10 MVP facets):

- **90 cells** have no facet mention in the last 180 days.
- **~40 cells** have *never* been mentioned in any review (3-year window).
- Even the most-covered facet (`check_in`) has cells on properties that haven't heard it discussed in >1 year.

## Per-facet staleness skew
| Facet | Avg days since last mention across properties |
|---|---|
| pet | ~520 |
| amenities_gym | ~480 |
| amenities_wifi | ~400 |
| check_out | ~310 |
| amenities_breakfast, check_in | ~40–90 |

`pet` and `gym` are the staleness champions. These are also policies that *change* — gym equipment breaks, pet fees get revised — so old evidence is untrustworthy.

## Volume × recency interaction
High-volume properties improve recency on more facets, but they do **not** eliminate the problem: even 1,000+ review properties still have year-old or never-seen cells. Low-volume properties (< 50 reviews) have the largest staleness deserts, so ReviewGap still adds the most value per question there.

## Operational definition used in the scoring layer
- `last_mention_date(property, facet)` = max `acquisition_date` where facet lexicon hits.
- `days_since = (today - last_mention_date).days`, capped at 9999 if never seen.
- `staleness_score = 1 - exp(-days_since / half_life_facet)` where `half_life_facet ∈ {60d for amenities, 180d for policies, 365d for structural}`.

## Takeaway
Staleness is not a rare edge case. The median (property, facet) cell hasn't been mentioned in **>6 months**. This is the single strongest signal driving the follow-up selection.
