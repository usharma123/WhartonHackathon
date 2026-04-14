# Finding 05 — Semantic Analysis (Embeddings)

All 4,091 non-trivial reviews (≥10 chars), 13 listing docs, 10 facet prototype sets, and 10 anti-claim probes were embedded with **`text-embedding-3-small`** (1,536-dim). Artifacts are cached under `data_artifacts/embeddings/` so re-runs are free.

> Update after the validation pass: treat this document as the **high-recall exploration layer**, not the final implementation spec. The stricter, implementation-facing conclusions now live in `findings/06_validation_pass.md`. In particular, permissive thresholds over-fire on `pet` and `children_extra_bed`, and the raw anti-claim ranking includes false positives.

> The single most important takeaway: **lexical (regex) facet detection is wildly under-counting reality.** On every facet we tested, semantic detection finds **2× to 14× more** mentions than regex, and many of the lexical-only hits are false positives (e.g., "dog-tired" triggering `pet`). Any scoring layer built on regex alone will miss most of the signal.

---

## 1. Lexical vs semantic facet coverage

See `charts/11_lexical_vs_semantic_facet.png` and `data_artifacts/lexical_vs_semantic.csv`.

| Facet | Lexical hits | Semantic hits (cos≥0.35) | Semantic-only | Jaccard |
|---|---|---|---|---|
| pet | 29 | 340 | 320 | 0.06 |
| check_in | 522 | 2,293 | 1,808 | 0.21 |
| check_out | 82 | 621 | 564 | 0.09 |
| amenities_pool | 275 | 1,348 | 1,093 | 0.19 |
| amenities_wifi | 63 | 109 | 77 | 0.23 |
| amenities_breakfast | 517 | 1,270 | 816 | 0.34 |
| amenities_parking | 290 | 1,426 | 1,202 | 0.15 |
| amenities_gym | 36 | 319 | 288 | 0.10 |
| children_extra_bed | 139 | 1,951 | 1,831 | 0.06 |
| know_before_you_go | 234 | 782 | 597 | 0.22 |

**Why agreement is so low:** the lexicon misses paraphrases ("we had to make arrangements off-site" → parking), modal claims ("family-friendly feeling" → children), and entire non-English reviews. KMeans (below) surfaced substantial Spanish and German clusters that the English regex can't see.

**Action for the scoring layer:** replace regex with semantic classification (cosine to facet prototypes) or a zero-shot NLI model. Keep regex as a cheap pre-filter only.

---

## 2. Listing ↔ review semantic drift

See `charts/12_listing_review_drift_heatmap.png` and `data_artifacts/listing_review_drift.csv`.

For each (property × facet), we compared the embedding of the **listing text** (pet_policy, check_in_instructions, etc.) to the embeddings of that property's reviews. Lower cosine = the listing says things the reviews don't echo = **most question-worthy**.

| Facet | Mean cosine (listing ↔ reviews) | Rank |
|---|---|---|
| pet | 0.18 | Worst drift |
| check_out | 0.20 | |
| know_before_you_go | 0.22 | |
| amenities_gym | 0.23 | |
| children_extra_bed | 0.27 | |
| (all facets overall) | **0.25** | |

These are exactly the facets where the listing makes claims that reviewers almost never corroborate — the highest-value targets for ReviewGap. Overall average cosine of 0.25 tells us the listing and reviews are living in nearly-disjoint semantic spaces.

---

## 3. Anti-claim conflict discovery

See `data_artifacts/semantic_conflict_top.csv`. Embedding each facet's **anti-claim** (e.g., "Wi-Fi did not work or was too slow") and finding each property's nearest reviews surfaces real grievances hiding in the corpus. Top examples:

> **Property `7d027ef7…` / pet**: *"they are a pet friendly hotel but there is no area at all to walk your pet… the morning of check-out we were interrogated about if I had paid the pet fee, to the point of harassment…"* — the listing says "pets welcome", the reality is a fee surprise. **Perfect ReviewGap question target.**

> **Property `7d027ef7…` / parking**: *"there was no parking upon arrival and I had to make parking arrangements off site"* — another listing-vs-reality gap on a high-impact facet.

> **Property `ff26cdda…` / breakfast**: *"half ingredients on the menu missing for breakfast — had to go somewhere else"* — contradicts a "breakfast included" claim.

This method yields **concrete, reviewer-grounded evidence** for which listing claims to challenge, and which question to ask the next reviewer.

---

## 4. Unsupervised topic discovery (KMeans k=14)

See `charts/13_review_clusters_pca.png` and `data_artifacts/topic_clusters.json`. The 14 clusters revealed:

- **Cluster 4 (n=469)** — strong negative cleanliness signals ("urine under the rim", "black spots on bathroom").
- **Cluster 10 (n=262)** — broken-fixture cluster ("shower broken from the wall", "mirrors dirty").
- **Cluster 6 (n=144)** — **Spanish-language reviews**. Entirely missed by the English regex.
- **Cluster 13 (n=136)** — **German-language reviews**. Ditto.
- **Cluster 3 (n=138)** — location-centric, Cannery Row / walkability.
- **Clusters 1, 5, 9, 11** — very short template-like reviews ("great stay", "very clean").

**Action:** the multilingual clusters tell us ReviewGap must support multilingual facet detection out of the box — either via the embedding model (which already handles it) or via translation before regex. The broken-fixture and cleanliness clusters suggest two facets we should promote to MVP: `room_maintenance` and `cleanliness_deep` (currently bundled under generic `room`).

---

## 5. Temporal drift — review content shifts over time

See `charts/14_temporal_drift.png` and `data_artifacts/temporal_drift.csv`.

Comparing the centroid of each property's **first-quarter** reviews to its **last-quarter** reviews:

| Property (prefix) | First Q → Last Q | Drift (1 − cosine) |
|---|---|---|
| 9a0043fd… | 2023Q1 → 2025Q4 | 0.17 |
| fa014137… | 2023Q1 → 2026Q1 | 0.16 |
| ff26cdda… | 2023Q1 → 2026Q1 | 0.14 |
| (most others) | — | 0.05 – 0.10 |

Drift of 0.17 is substantial at embedding scale — it means *what reviewers talk about has materially shifted.* This is direct evidence that stale listing descriptions cause stale signal, and it gives us a per-property freshness dial beyond simple recency.

---

## 6. Redundancy — echo-chamber detection

See `charts/15_redundancy_per_property.png` and `data_artifacts/redundancy_per_property.csv`.

Mean pairwise cosine within a 150-review sample per property ranges from **0.28 to 0.45**. High values (≥0.40) mean most reviews are saying the same thing — usually short praise ("great stay", "clean and friendly"). These properties **benefit most from a follow-up question** because the raw corpus is not differentiating itself.

---

## 7. Semantic facet score distributions

See `charts/16_semantic_score_distributions.png`. Almost every facet's cosine distribution is bimodal — a "not mentioned at all" hump near 0.15 and a clear right tail for actual mentions. The 0.35 threshold cleanly separates the modes for most facets; `amenities_wifi` has a narrower tail (fewer reviewers mention wifi at all).

**Action:** tune per-facet thresholds rather than using a global 0.35 — we include the distributions so the product team can pick thresholds empirically.

---

## Operational recommendations (feed into Finding 04)

1. **Replace or augment the regex facet detector** with a semantic classifier (cosine-to-prototype, thresholded per facet). Keep this pre-computed for the stored corpus; run live for the in-progress review.
2. **Promote listing↔review drift into the priority score**: add term `w7 · (1 − cos(listing_facet, review_centroid))`. Low cosine = high priority to ask.
3. **Add anti-claim probing as a targeted conflict signal**: rank reviews by `cos(review, anti_claim) · cos(review, listing)` to surface "reviewers who contradict the listing on this facet". Show judges this list — it is the most visceral demo artifact.
4. **Use KMeans clusters as a cold-start facet expansion mechanism.** Properties without their own review history can borrow prior from the cluster their listing embeds nearest to.
5. **Temporal drift as staleness proxy for facets we can't lexicalize.** If the latest-quarter centroid has moved far from prior quarters, the listing is *topically* stale even if each facet's mention count looks fine.
6. **Redundancy weights the value of asking.** A high-redundancy property returns more information per follow-up than a diverse one; deploy the question UI more aggressively there.
7. **Multilingual support is not optional.** ~280 reviews are Spanish/German. `text-embedding-3-small` handles them natively; regex does not.
