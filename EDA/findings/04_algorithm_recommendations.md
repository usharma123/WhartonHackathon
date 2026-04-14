# Finding 04 — Algorithm Recommendations

This document specifies the ranking and question-generation engine for ReviewGap. It proposes **three tiers** (deterministic, ML, LLM) and a **hybrid** that ties them together for the demo.

## TL;DR
- Use a **rule-based priority score** as the spine — judges can inspect it; it runs in ms.
- Use the **LLM** (GPT-4o-mini) for NL understanding (facet detection in the live review) and NL generation (phrasing the question).
- Use **light ML** (TF-IDF / sentence embeddings + sentiment) to strengthen facet detection and conflict scoring where regex is brittle.
- **Backend:** Python + FastAPI. **Frontend:** JS/TS (Next.js or Vite + React). Rust offers no wins here.

---

## Tier A — Deterministic (baseline, always-on)

### Priority score (semantic-aware)
For each facet `f` on property `p`, given in-progress review text `R`:

```
priority(f, p, R) =
    w1 * importance(f)
  + w2 * staleness(p, f)
  + w3 * conflict(p, f)
  + w4 * (1 - coverage_sem(p, f))
  + w5 * listing_review_drift(p, f)        # semantic
  + w6 * temporal_drift(p)                 # semantic
  + w7 * redundancy(p)                     # semantic
  - w8 * already_mentioned_sem(R, f)       # semantic
  - w9 * 1{cold_start and f is low-prior}
```

| Term | Definition | Source |
|---|---|---|
| `importance(f)` | Hand-tuned prior ∈ [0,1] per facet | Business input (pet=0.9, gym=0.4, etc.) |
| `staleness(p, f)` | `1 - exp(-days_since / half_life_f)` | `property_facet_freshness.csv` |
| `conflict(p, f)` | `P(neg_share > 0.3 \| data)` beta posterior + anti-claim rank | `conflict_candidates.csv`, `semantic_conflict_top.csv` |
| `coverage_sem(p, f)` | Fraction of reviews with `cos(review, facet_proto) ≥ τ_f` | `semantic_facet_scores.parquet` |
| `listing_review_drift(p, f)` | `1 − cos(listing_doc_f, review_centroid_p)` | `listing_review_drift.csv` |
| `temporal_drift(p)` | `1 − cos(first_q_centroid, last_q_centroid)` | `temporal_drift.csv` |
| `redundancy(p)` | Mean pairwise cosine of property's reviews | `redundancy_per_property.csv` |
| `already_mentioned_sem(R, f)` | `1` if `cos(R, facet_proto_f) ≥ τ_f` | Live (embed R, compare) |
| `cold_start` | 1 if `total_reviews(p) < 20` | Live |

Starting weights (tune empirically): `w = (0.20, 0.25, 0.20, 0.15, 0.20, 0.10, 0.05, 1.0, 0.10)`.

**Why the extra semantic terms matter** (from Finding 05): lexical detection undercounts by 2–14× per facet; listing↔review cosine is 0.25 on average (practically disjoint); some properties show 17% temporal drift. These are measurable signals, not hypotheticals — all precomputed in the EDA artifacts.

### Half-life presets
- Physical amenities (pool, wifi, gym): **60 days**
- Policy facets (pet, check-in, check-out, children): **180 days**
- Structural (location, room): **365 days**

### Cold-start fallback
For properties with <20 reviews, drop conflict/coverage/staleness and rank only on `importance(f)` + `listing_age`.

**Why this tier exists:** deterministic, fast (<5ms), auditable — every ranking decision can be traced to a number in a CSV. Judges love this.

---

## Tier B — ML layer (augments Tier A inputs)

### Facet classification (replaces regex) — **now backed by measured data**
- **Why:** Regex is brittle and misses multilingual reviews entirely (Finding 05 §4 discovered sizable Spanish and German clusters). Measured Jaccard agreement between regex and semantic detection ranges from 0.06 (pet) to 0.34 (breakfast).
- **Production path:** cosine-to-prototype against `text-embedding-3-small` (already cached), thresholded per facet from `charts/16_semantic_score_distributions.png`.
- **Free upgrade:** swap prototypes for a hand-labeled 200-example zero-shot set with `bart-mnli` if we want confidence calibration.
- **Output:** per-sentence `{facet: cosine}` dict; per-facet threshold τ_f picked from the bimodal distribution inflection.

### Per-facet sentiment
- **Why:** Cue-word sentiment missed sarcasm and negation in ~15% of spot-checks.
- **How:** `cardiffnlp/twitter-roberta-base-sentiment` on facet-matched sentences.
- **Feeds:** `conflict(p, f)` instead of pos/neg cue counts.

### Topic discovery (BERTopic)
- Surfaces facets we didn't anticipate (noise, elevator, breakfast quality, pricing surprises).
- Run offline; expand the facet list if a topic has ≥50 mentions and high coherence.

### Embedding staleness — **already built in EDA**
- Temporal drift per property (first-quarter vs last-quarter centroid) is in `data_artifacts/temporal_drift.csv`.
- Three properties exceed 14% drift at embedding scale — feed directly into the priority score.
- For cold-start: compare a new property's listing embedding to the nearest-neighbor property and borrow its facet priors.

### Learned ranker (future)
- Once demo feedback logs exist (skipped vs. answered, answer length), train LightGBM to re-weight Tier A features. Offline now.

---

## Tier C — LLM layer (GPT-4o-mini, OpenAI key in `.env`)

### Call 1: Review Understanding (on every keystroke ≥20 chars, debounced)
**Prompt schema (function-calling):**
```json
{
  "name": "analyze_review",
  "parameters": {
    "type": "object",
    "properties": {
      "facets_mentioned": {"type": "array", "items": {"type": "string"}},
      "sentiment_per_facet": {"type": "object"},
      "reviewer_likely_knows": {"type": "array", "items": {"type": "string"}}
    }
  }
}
```
**Cost:** ~120 input tokens + 80 output = $0.00003 per call. Cached by review hash.

### Call 2: Question Generation
**Input:** top-ranked facet, property facts, review text, list of "do not repeat" topics.
**Output:** one natural follow-up, ≤20 words, voice-friendly alt.
**Example:** "One quick thing — was the gym fully open during your stay?"

### Call 3: Answer → Structured Fact
**Function-calling schema:**
```json
{
  "facet": "pet",
  "facts": {
    "pet_fee_reported": true,
    "pet_fee_amount_usd": 25,
    "pet_policy_surprise": true,
    "confidence": 0.85
  },
  "updates_listing_field": "pet_policy"
}
```

### Call 4: Property-Card Delta
One-sentence summary of what the new fact changes on the listing.

---

## Tier D — Hybrid pipeline (recommended for demo)

```
┌────────────────────────────────────────────────────────────────┐
│ Reviewer types in the review box                               │
└───────────┬────────────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────┐
   │ LLM analyze_review   │ ◄── Tier C, call 1 (debounced 800ms)
   │ → facets_mentioned   │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ Rule engine          │ ◄── Tier A
   │ priority(f, p, R)    │     (reads pre-computed Tier B outputs)
   │ for each facet       │
   └──────────┬───────────┘
              │   argmax(priority)
              ▼
   ┌──────────────────────┐
   │ LLM generate_question│ ◄── Tier C, call 2
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ Reviewer answers     │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ LLM extract_fact     │ ◄── Tier C, call 3
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ Persist + refresh    │ ◄── Tier A
   │ property_facet state │
   └──────────────────────┘
```

**Latency budget:** analyze (debounced) + rank (<10ms) + question (500–900ms) = felt as a natural pause after the user stops typing.

---

## Stack choices

| Layer | Choice | Why |
|---|---|---|
| EDA / scoring | Python 3.13 | Pandas + matplotlib already in use; venv via `uv` |
| Backend | Python + **FastAPI** (`uvicorn` ASGI) | Async, native OpenAI SDK, hot-reloads for demo iteration |
| Frontend | **Next.js (TS)** or Vite + React | SSE streaming for question; Web Speech API for voice |
| State | In-memory dict → Redis if needed | Pre-compute per-property priority at startup |
| LLM | OpenAI `gpt-4o-mini` | Function calling, cheap, fast |
| Deployment | Vercel (frontend) + Fly.io / Render (backend) | 10-min deploy |

### Why not Rust
- Everything on the critical path is I/O-bound (OpenAI API calls) or pandas — Rust's speedups don't show.
- Re-implementing pandas scoring in Polars + axum would cost 1–2 days and add zero demo-visible value.
- Save Rust for a v2 once we have volume.

---

## What to implement first (MVP order)
1. Load `property_facet_freshness.csv` + `conflict_candidates.csv` into FastAPI at startup.
2. Implement Tier A priority function in pure Python (≤80 lines).
3. Wire Tier C call 1 + call 2 behind `/api/next-question`.
4. Minimal Next.js page: review textarea → SSE stream of question → answer box → updated-facts card.
5. Add Tier C call 3 for fact extraction.
6. Demo-polish: 3 curated properties where pet/check-out/wifi conflicts are obvious.

Skip Tier B for the initial demo — it's the v2 robustness upgrade. Add BERTopic if time permits, purely as a "look, we discovered facets you didn't know existed" slide.
