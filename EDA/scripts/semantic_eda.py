"""ReviewGap — Semantic EDA.

Extends the lexical EDA with embedding-based analysis:
 1. Review + listing embeddings (OpenAI text-embedding-3-small).
 2. Semantic facet detection via prototype sentences (compare to lexical).
 3. Listing <-> review drift per property.
 4. Unsupervised topic discovery (KMeans on embeddings + PCA viz).
 5. Temporal drift: per-property embedding trajectory across quarters.
 6. Semantic conflict: reviews nearest to anti-claims of listing statements.
 7. Redundancy: avg pairwise similarity per property (echo chamber detection).

Embeddings are cached to `EDA/data_artifacts/embeddings/` so re-runs are cheap.

Run:
    .venv/bin/python EDA/scripts/semantic_eda.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics.pairwise import cosine_similarity

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "EDA"
CHARTS = OUT / "charts"
ARTIFACTS = OUT / "data_artifacts"
FINDINGS = OUT / "findings"
EMB_DIR = ARTIFACTS / "embeddings"
for p in (CHARTS, ARTIFACTS, FINDINGS, EMB_DIR):
    p.mkdir(parents=True, exist_ok=True)

load_dotenv(ROOT / ".env")
MODEL = "text-embedding-3-small"  # 1536-dim, $0.02 / 1M tokens

TODAY = pd.Timestamp("2026-04-13")

# ---- Facet prototypes (short, canonical phrases per facet) ----
FACET_PROTOTYPES = {
    "pet": [
        "The hotel allows pets and dogs.",
        "They charged an unexpected pet fee.",
        "No pets allowed here.",
    ],
    "check_in": [
        "Check-in at the front desk was quick and smooth.",
        "Check-in was slow and we waited a long time at reception.",
        "We had trouble getting our room key at arrival.",
    ],
    "check_out": [
        "Check-out in the morning was easy.",
        "They charged an early check-out fee.",
        "Late checkout was not allowed.",
    ],
    "amenities_pool": [
        "The swimming pool was open and clean.",
        "The pool was closed during our stay.",
        "We enjoyed the hot tub and spa.",
    ],
    "amenities_wifi": [
        "The Wi-Fi was fast and reliable.",
        "Wi-Fi was too slow to work on.",
        "Internet connection kept dropping.",
    ],
    "amenities_breakfast": [
        "Breakfast buffet was included and delicious.",
        "Breakfast was disappointing and limited.",
        "No breakfast options available.",
    ],
    "amenities_parking": [
        "Free parking was available on site.",
        "Parking was expensive and hard to find.",
        "Valet parking service was excellent.",
    ],
    "amenities_gym": [
        "The fitness center had good equipment.",
        "The gym was small and crowded.",
        "Gym equipment was broken or out of service.",
    ],
    "children_extra_bed": [
        "The hotel was family-friendly with cribs available.",
        "They did not provide an extra bed or rollaway.",
        "Kids had a great time and facilities for children were great.",
    ],
    "know_before_you_go": [
        "There was ongoing construction and noise during our stay.",
        "Unexpected fees and deposits at check-in.",
        "Surprising restrictions we were not told about.",
    ],
}
FACETS = list(FACET_PROTOTYPES.keys())

POSITIVE_CLAIMS = {
    "pet": [
        "Pets were welcome and the pet policy was clear.",
        "There were no surprise pet restrictions or pet fees.",
    ],
    "check_in": [
        "Check-in was smooth and quick.",
        "The front desk was ready for our arrival.",
    ],
    "check_out": [
        "Check-out was easy and there were no surprise fees.",
        "Late checkout worked as expected.",
    ],
    "amenities_pool": [
        "The pool was open, clean, and usable.",
        "The hot tub and pool area matched the listing.",
    ],
    "amenities_wifi": [
        "The Wi-Fi worked well and matched the listing.",
        "Internet speed was reliable enough for work.",
    ],
    "amenities_breakfast": [
        "Breakfast was available as advertised.",
        "The breakfast offering matched the listing.",
    ],
    "amenities_parking": [
        "Parking was available and convenient.",
        "The property had parking as advertised.",
    ],
    "amenities_gym": [
        "The gym was open and the equipment worked.",
        "The fitness center matched the listing.",
    ],
    "children_extra_bed": [
        "The room worked well for children and extra bed needs.",
        "Cribs or extra beds were available as expected.",
    ],
    "know_before_you_go": [
        "There were no hidden fees or surprise restrictions.",
        "There was no disruptive construction or noise issue.",
    ],
}

# Anti-claim probes for conflict detection (pair with positive listing claims)
ANTI_CLAIMS = {
    "pet": "Pets were not actually welcome and we were charged surprise fees.",
    "check_in": "Check-in was chaotic and slow.",
    "check_out": "Check-out was complicated and we were charged fees.",
    "amenities_pool": "The pool was closed, dirty, or unusable.",
    "amenities_wifi": "The Wi-Fi did not work or was too slow to use.",
    "amenities_breakfast": "Breakfast was not as advertised or unavailable.",
    "amenities_parking": "Parking was difficult, expensive, or not available.",
    "amenities_gym": "The gym was broken, closed, or not usable.",
    "children_extra_bed": "The room was not suitable for kids; no extra bed was provided.",
    "know_before_you_go": "There were hidden fees, construction, or serious noise problems.",
}

NEGATIVE_HINTS = {
    "pet": r"\b(?:no pet|not pet friendly|pet fee|charged.*pet|dog fee|animal fee|cleaning fee|pet policy)\b",
    "check_in": r"\b(?:wait(?:ed|ing)?|line|slow|chaotic|not ready|after-hours|front desk.*rude|check.?in.*problem)\b",
    "check_out": r"\b(?:check.?out.*fee|charged|late checkout|early checkout|complicated|problem)\b",
    "amenities_pool": r"\b(?:closed|dirty|crowded|debris|unusable|not heated|too cold|broken heater)\b",
    "amenities_wifi": r"\b(?:slow|didn'?t work|not work|dropping|disconnect|weak|spotty|wireless.*slow)\b",
    "amenities_breakfast": r"\b(?:not included|missing|limited|disappointing|cold|ran out|no syrup|nothing ready)\b",
    "amenities_parking": r"\b(?:no parking|limited parking|tight|off site|expensive|hard to find|parking is a problem|difficult to get|not enough parking)\b",
    "amenities_gym": r"\b(?:closed|broken|small|crowded|out of service)\b",
    "children_extra_bed": r"\b(?:no crib|no cot|no rollaway|no extra bed|not suitable for kids|kid'?s menu|children.*not|extra bed.*not)\b",
    "know_before_you_go": r"\b(?:hidden fee|unexpected|construction|noise|noisy|no elevator|restriction|deposit|extra charge|city/local tax|boarded up)\b",
}


# ---------- embedding cache ----------
def _cache_key(texts: list[str]) -> str:
    h = hashlib.sha1()
    for t in texts:
        h.update(t.encode("utf-8", errors="ignore"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


_CLIENT: OpenAI | None = None


def get_client() -> OpenAI:
    global _CLIENT
    if _CLIENT is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required when embeddings are not already cached.")
        _CLIENT = OpenAI(api_key=api_key)
    return _CLIENT


def embed_batch(texts: list[str], label: str, batch_size: int = 512) -> np.ndarray:
    key = _cache_key(texts)
    cache = EMB_DIR / f"{label}_{key}.npy"
    if cache.exists():
        print(f"  [cache hit] {label} → {cache.name}")
        return np.load(cache)
    print(f"  [embedding] {label}: {len(texts)} texts...")
    out = []
    for i in range(0, len(texts), batch_size):
        chunk = [t if t.strip() else " " for t in texts[i:i + batch_size]]
        for attempt in range(3):
            try:
                resp = get_client().embeddings.create(model=MODEL, input=chunk)
                out.extend([d.embedding for d in resp.data])
                break
            except Exception as e:
                print(f"    retry {attempt + 1}: {e}")
                time.sleep(2 ** attempt)
        else:
            raise RuntimeError(f"embedding failed after 3 retries for {label} batch {i}")
    arr = np.asarray(out, dtype=np.float32)
    np.save(cache, arr)
    return arr


# ---------- data loading ----------
def load_data():
    desc = pd.read_csv(DATA / "Description_PROC.csv")
    rev = pd.read_csv(DATA / "Reviews_PROC.csv")
    rev["acquisition_date"] = pd.to_datetime(rev["acquisition_date"], format="%m/%d/%y", errors="coerce")
    rev["review_text"] = rev["review_text"].fillna("")
    rev["review_title"] = rev["review_title"].fillna("")
    rev["full_text"] = (rev["review_title"] + ". " + rev["review_text"]).str.strip(". ").str.strip()
    rev = rev[rev["full_text"].str.len() >= 10].reset_index(drop=True)
    return desc, rev


def build_listing_docs(desc: pd.DataFrame) -> dict[str, dict]:
    """One text per (property × facet) derived from structured listing fields."""
    facet_fields = {
        "pet": ["pet_policy"],
        "check_in": ["check_in_start_time", "check_in_end_time", "check_in_instructions"],
        "check_out": ["check_out_time", "check_out_policy"],
        "amenities_pool": ["property_amenity_outdoor", "property_amenity_spa", "popular_amenities_list"],
        "amenities_wifi": ["property_amenity_internet", "popular_amenities_list"],
        "amenities_breakfast": ["property_amenity_food_and_drink", "popular_amenities_list"],
        "amenities_parking": ["property_amenity_parking", "popular_amenities_list"],
        "amenities_gym": ["property_amenity_more", "property_amenity_things_to_do"],
        "children_extra_bed": ["children_and_extra_bed_policy", "property_amenity_family_friendly"],
        "know_before_you_go": ["know_before_you_go"],
    }
    out = {}
    for _, row in desc.iterrows():
        pid = row["eg_property_id"]
        out[pid] = {}
        for facet, cols in facet_fields.items():
            parts = []
            for c in cols:
                v = row.get(c)
                if isinstance(v, str) and v.strip() and v.strip() != "[]":
                    parts.append(v.strip())
            out[pid][facet] = " ".join(parts)[:1000] if parts else ""
    return out


# ---------- analyses ----------
def semantic_facet_scores(rev_emb: np.ndarray, proto_emb_by_facet: dict) -> pd.DataFrame:
    """Per-review max-cosine to each facet's prototypes."""
    scores = {}
    for facet, pe in proto_emb_by_facet.items():
        sims = cosine_similarity(rev_emb, pe)  # (n_rev, n_protos)
        scores[facet] = sims.max(axis=1)
    return pd.DataFrame(scores)


def otsu_threshold(scores: pd.Series, bins: int = 80,
                   lower: float = 0.15, upper: float = 0.65) -> float:
    values = scores.dropna().clip(lower=lower, upper=upper).to_numpy()
    if len(values) == 0:
        return 0.35
    hist, edges = np.histogram(values, bins=bins, range=(lower, upper))
    if hist.sum() == 0 or np.count_nonzero(hist) <= 1:
        return 0.35
    mids = (edges[:-1] + edges[1:]) / 2
    prob = hist / hist.sum()
    omega = np.cumsum(prob)
    mu = np.cumsum(prob * mids)
    mu_t = mu[-1]
    denom = omega * (1 - omega)
    denom[denom == 0] = np.nan
    between = ((mu_t * omega - mu) ** 2) / denom
    idx = int(np.nanargmax(between))
    return float(np.clip(mids[idx], 0.22, 0.5))


def threshold_sweep(sem_scores: pd.DataFrame, lex_hits: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, float]]:
    rows = []
    otsu_thresholds = {}
    grid = [0.25, 0.30, 0.35, 0.40, 0.45]
    for facet in FACETS:
        thresh = otsu_threshold(sem_scores[facet])
        otsu_thresholds[facet] = thresh
        lex_hit = lex_hits[facet].astype(int)
        for threshold in grid + [thresh]:
            sem_hit = (sem_scores[facet] >= threshold).astype(int)
            both = int(((sem_hit == 1) & (lex_hit == 1)).sum())
            total_sem = int(sem_hit.sum())
            total_lex = int(lex_hit.sum())
            rows.append({
                "facet": facet,
                "threshold": round(float(threshold), 4),
                "threshold_type": "otsu" if abs(threshold - thresh) < 1e-9 else "grid",
                "semantic_hits": total_sem,
                "lexical_hits": total_lex,
                "semantic_hit_rate": float(total_sem / max(len(sem_scores), 1)),
                "agreement_jaccard": both / max(total_sem + total_lex - both, 1),
            })
    threshold_df = pd.DataFrame(rows)
    selected_thresholds = {}
    for facet in FACETS:
        sub = threshold_df[(threshold_df["facet"] == facet) & (threshold_df["threshold_type"] == "grid")].copy()
        sub = sub[sub["threshold"] >= 0.35]
        best = sub.sort_values(["agreement_jaccard", "threshold"], ascending=[False, False]).iloc[0]
        selected_thresholds[facet] = float(max(otsu_thresholds[facet], best["threshold"]))
    return threshold_df, selected_thresholds


def classify_semantic_hits(sem_scores: pd.DataFrame, thresholds: dict[str, float]) -> pd.DataFrame:
    return pd.DataFrame({
        facet: (sem_scores[facet] >= thresholds[facet]).astype(int)
        for facet in FACETS
    })


def write_table(df: pd.DataFrame, path: Path) -> Path:
    if path.suffix == ".parquet":
        try:
            df.to_parquet(path, index=False)
            return path
        except ImportError:
            fallback = path.with_suffix(".csv")
            df.to_csv(fallback, index=False)
            return fallback
    df.to_csv(path, index=False)
    return path


def semantic_audit_samples(rev: pd.DataFrame, sem_scores: pd.DataFrame, lex_hits: pd.DataFrame,
                           thresholds: dict[str, float], per_bucket: int = 5) -> pd.DataFrame:
    rows = []
    for facet in FACETS:
        score = sem_scores[facet]
        threshold = thresholds[facet]
        lexical = lex_hits[facet].astype(int)
        frame = rev[["eg_property_id", "acquisition_date", "full_text"]].copy()
        frame["facet"] = facet
        frame["score"] = score
        frame["threshold"] = threshold
        frame["lexical_hit"] = lexical
        frame["semantic_hit"] = (score >= threshold).astype(int)
        frame["snippet"] = frame["full_text"].str.slice(0, 220)

        semantic_only = frame[(frame["semantic_hit"] == 1) & (frame["lexical_hit"] == 0)].nlargest(per_bucket, "score")
        borderline = frame[(frame["semantic_hit"] == 1) & (frame["lexical_hit"] == 0)].copy()
        borderline["distance"] = (borderline["score"] - threshold).abs()
        borderline = borderline.nsmallest(per_bucket, "distance")
        lexical_only = frame[(frame["semantic_hit"] == 0) & (frame["lexical_hit"] == 1)].sort_values("score", ascending=False).head(per_bucket)

        for bucket_name, bucket in (
            ("semantic_only_top", semantic_only),
            ("semantic_only_borderline", borderline),
            ("lexical_only", lexical_only),
        ):
            if bucket.empty:
                continue
            out = bucket[["eg_property_id", "acquisition_date", "facet", "score", "threshold", "snippet"]].copy()
            out.insert(3, "bucket", bucket_name)
            rows.append(out)
    if not rows:
        return pd.DataFrame(columns=["eg_property_id", "acquisition_date", "facet", "bucket", "score", "threshold", "snippet"])
    return pd.concat(rows, ignore_index=True)


def compare_lexical_vs_semantic(rev: pd.DataFrame, sem_scores: pd.DataFrame,
                                lex_hits: pd.DataFrame, threshold: float = 0.35) -> pd.DataFrame:
    rows = []
    for facet in FACETS:
        sem_hit = (sem_scores[facet] >= threshold).astype(int)
        lex_hit = lex_hits[facet].astype(int) if facet in lex_hits.columns else pd.Series(0, index=rev.index)
        both = int(((sem_hit == 1) & (lex_hit == 1)).sum())
        only_sem = int(((sem_hit == 1) & (lex_hit == 0)).sum())
        only_lex = int(((sem_hit == 0) & (lex_hit == 1)).sum())
        total_sem = int(sem_hit.sum())
        total_lex = int(lex_hit.sum())
        rows.append({
            "facet": facet, "lexical_hits": total_lex, "semantic_hits": total_sem,
            "both": both, "lex_only": only_lex, "sem_only": only_sem,
            "agreement_jaccard": both / max(total_sem + total_lex - both, 1),
        })
    return pd.DataFrame(rows)


def listing_review_drift(desc: pd.DataFrame, rev: pd.DataFrame,
                         listing_emb_by_facet: dict, rev_emb: np.ndarray) -> pd.DataFrame:
    """For each (property, facet): avg cosine between listing statement and
    that property's reviews. Lower = more drift between what the listing
    claims and what reviews actually discuss."""
    rows = []
    for pid, fe in listing_emb_by_facet.items():
        mask = (rev["eg_property_id"].values == pid)
        if mask.sum() == 0:
            continue
        prop_emb = rev_emb[mask]
        for facet, vec in fe.items():
            if vec is None:
                continue
            sims = cosine_similarity(prop_emb, vec.reshape(1, -1)).ravel()
            rows.append({
                "eg_property_id": pid, "facet": facet,
                "n_reviews": int(mask.sum()),
                "mean_cos": float(sims.mean()),
                "top5_mean_cos": float(np.sort(sims)[-5:].mean()) if mask.sum() >= 5 else float(sims.max()),
                "pct_reviews_cos_gt_0_4": float((sims >= 0.4).mean()),
            })
    return pd.DataFrame(rows)


def listing_review_drift_matched(rev: pd.DataFrame, sem_scores: pd.DataFrame, thresholds: dict[str, float],
                                 listing_emb_by_facet: dict, rev_emb: np.ndarray) -> pd.DataFrame:
    rows = []
    for pid, fe in listing_emb_by_facet.items():
        prop_mask = (rev["eg_property_id"].values == pid)
        if prop_mask.sum() == 0:
            continue
        prop_emb = rev_emb[prop_mask]
        prop_scores = sem_scores.loc[prop_mask, FACETS]
        for facet, vec in fe.items():
            if vec is None:
                continue
            all_sims = cosine_similarity(prop_emb, vec.reshape(1, -1)).ravel()
            matched_mask = prop_scores[facet].to_numpy() >= thresholds[facet]
            matched_sims = all_sims[matched_mask]
            rows.append({
                "eg_property_id": pid,
                "facet": facet,
                "total_reviews": int(prop_mask.sum()),
                "matched_reviews": int(matched_mask.sum()),
                "matched_review_rate": float(matched_mask.mean()),
                "mean_cos_all_reviews": float(all_sims.mean()),
                "mean_cos_matched_reviews": float(matched_sims.mean()) if len(matched_sims) else np.nan,
                "p90_cos_matched_reviews": float(np.quantile(matched_sims, 0.9)) if len(matched_sims) else np.nan,
            })
    return pd.DataFrame(rows)


def anti_claim_conflict(rev: pd.DataFrame, rev_emb: np.ndarray,
                        anti_emb: dict, listing_emb_by_facet: dict,
                        top_k: int = 3) -> pd.DataFrame:
    """For each (property, facet), find reviews closest to the anti-claim
    (e.g., 'pool was closed') — surfaces reviewers who contradict the listing."""
    rows = []
    for pid in rev["eg_property_id"].unique():
        mask = rev["eg_property_id"].values == pid
        idxs = np.where(mask)[0]
        if len(idxs) < 5:
            continue
        prop_emb = rev_emb[idxs]
        for facet, a_vec in anti_emb.items():
            listing_vec = listing_emb_by_facet.get(pid, {}).get(facet)
            if listing_vec is None or not isinstance(listing_vec, np.ndarray):
                continue
            sims_to_anti = cosine_similarity(prop_emb, a_vec.reshape(1, -1)).ravel()
            sims_to_listing = cosine_similarity(prop_emb, listing_vec.reshape(1, -1)).ravel()
            # A review is a "contradictor" if it's near the anti-claim AND near the listing topic.
            contradict_score = sims_to_anti * np.clip(sims_to_listing, 0, 1)
            top_idx_local = np.argsort(contradict_score)[-top_k:][::-1]
            for li in top_idx_local:
                global_i = idxs[li]
                rows.append({
                    "eg_property_id": pid, "facet": facet,
                    "review_idx": int(global_i),
                    "cos_anti": float(sims_to_anti[li]),
                    "cos_listing": float(sims_to_listing[li]),
                    "contradict_score": float(contradict_score[li]),
                    "acquisition_date": rev.iloc[global_i]["acquisition_date"],
                    "review_snippet": rev.iloc[global_i]["full_text"][:240],
                })
    df = pd.DataFrame(rows)
    if len(df):
        df = df.sort_values("contradict_score", ascending=False)
    return df


def validated_anti_claim_conflict(rev: pd.DataFrame, rev_emb: np.ndarray, sem_scores: pd.DataFrame,
                                  thresholds: dict[str, float], anti_emb: dict,
                                  positive_emb: dict, listing_emb_by_facet: dict,
                                  top_k: int = 5) -> pd.DataFrame:
    rows = []
    texts = rev["full_text"].fillna("").str.lower()
    for pid in rev["eg_property_id"].unique():
        prop_mask = rev["eg_property_id"].values == pid
        idxs = np.where(prop_mask)[0]
        if len(idxs) < 5:
            continue
        prop_emb = rev_emb[idxs]
        prop_scores = sem_scores.iloc[idxs]
        prop_text = texts.iloc[idxs]
        for facet in FACETS:
            listing_vec = listing_emb_by_facet.get(pid, {}).get(facet)
            if listing_vec is None or not isinstance(listing_vec, np.ndarray):
                continue
            facet_mask = prop_scores[facet].to_numpy() >= thresholds[facet]
            if facet_mask.sum() == 0:
                continue
            neg_sim = cosine_similarity(prop_emb, anti_emb[facet].reshape(1, -1)).ravel()
            pos_sim = cosine_similarity(prop_emb, positive_emb[facet]).max(axis=1)
            listing_sim = cosine_similarity(prop_emb, listing_vec.reshape(1, -1)).ravel()
            neg_hint = prop_text.str.contains(NEGATIVE_HINTS[facet], regex=True, na=False).astype(int).to_numpy()
            neg_delta = neg_sim - pos_sim
            validated = facet_mask & (neg_sim >= 0.35) & (neg_delta >= 0.03) & (neg_hint == 1)
            if validated.sum() == 0:
                continue
            candidate_positions = np.where(validated)[0]
            score = neg_delta * np.clip(listing_sim, 0, 1)
            top_local = candidate_positions[np.argsort(score[candidate_positions])[-top_k:][::-1]]
            for li in top_local:
                global_i = idxs[li]
                rows.append({
                    "eg_property_id": pid,
                    "facet": facet,
                    "review_idx": int(global_i),
                    "semantic_score": float(prop_scores.iloc[li][facet]),
                    "threshold": float(thresholds[facet]),
                    "cos_negative": float(neg_sim[li]),
                    "cos_positive": float(pos_sim[li]),
                    "neg_delta": float(neg_delta[li]),
                    "cos_listing": float(listing_sim[li]),
                    "neg_hint": int(neg_hint[li]),
                    "validated_conflict_score": float(score[li]),
                    "acquisition_date": rev.iloc[global_i]["acquisition_date"],
                    "review_snippet": rev.iloc[global_i]["full_text"][:240],
                })
    if not rows:
        return pd.DataFrame(columns=[
            "eg_property_id", "facet", "review_idx", "semantic_score", "threshold",
            "cos_negative", "cos_positive", "neg_delta", "cos_listing", "neg_hint",
            "validated_conflict_score", "acquisition_date", "review_snippet",
        ])
    return pd.DataFrame(rows).sort_values("validated_conflict_score", ascending=False)


def discover_topics(rev: pd.DataFrame, rev_emb: np.ndarray, k: int = 14):
    km = KMeans(n_clusters=k, n_init=10, random_state=0)
    labels = km.fit_predict(rev_emb)
    # label each cluster by its 5 nearest reviews to the centroid
    centroids = km.cluster_centers_
    cluster_rows = []
    for c in range(k):
        dists = np.linalg.norm(rev_emb - centroids[c], axis=1)
        members = np.where(labels == c)[0]
        nearest = members[np.argsort(dists[members])[:5]]
        snippets = [rev.iloc[i]["full_text"][:140] for i in nearest]
        cluster_rows.append({"cluster": c, "size": int(len(members)),
                             "snippets": snippets})
    return labels, centroids, pd.DataFrame(cluster_rows)


def temporal_drift(rev: pd.DataFrame, rev_emb: np.ndarray) -> pd.DataFrame:
    """Per property: cosine similarity between earliest-quarter centroid and latest-quarter centroid."""
    rev = rev.copy()
    rev["_q"] = rev["acquisition_date"].dt.to_period("Q")
    rows = []
    for pid, g in rev.groupby("eg_property_id"):
        qs = sorted(g["_q"].dropna().unique())
        if len(qs) < 2:
            continue
        first_mask = (g["_q"] == qs[0]).values
        last_mask = (g["_q"] == qs[-1]).values
        first_emb = rev_emb[g.index.values[first_mask]]
        last_emb = rev_emb[g.index.values[last_mask]]
        if len(first_emb) < 3 or len(last_emb) < 3:
            continue
        c0, c1 = first_emb.mean(axis=0, keepdims=True), last_emb.mean(axis=0, keepdims=True)
        cos = float(cosine_similarity(c0, c1)[0, 0])
        rows.append({
            "eg_property_id": pid,
            "first_quarter": str(qs[0]), "last_quarter": str(qs[-1]),
            "n_first": int(first_mask.sum()), "n_last": int(last_mask.sum()),
            "cosine_first_vs_last": cos,
            "drift": 1 - cos,
        })
    return pd.DataFrame(rows).sort_values("drift", ascending=False)


def redundancy_per_property(rev: pd.DataFrame, rev_emb: np.ndarray, sample: int = 150) -> pd.DataFrame:
    """Avg pairwise cosine in a sample of each property's reviews.
    High redundancy → reviewers echoing each other → follow-ups especially useful."""
    rng = np.random.default_rng(0)
    rows = []
    for pid, g in rev.groupby("eg_property_id"):
        idx = g.index.values
        if len(idx) < 10:
            continue
        if len(idx) > sample:
            idx = rng.choice(idx, size=sample, replace=False)
        E = rev_emb[idx]
        sims = cosine_similarity(E)
        iu = np.triu_indices(len(idx), k=1)
        mean_sim = float(sims[iu].mean())
        rows.append({"eg_property_id": pid, "n_sampled": len(idx),
                     "mean_pairwise_cosine": mean_sim})
    return pd.DataFrame(rows).sort_values("mean_pairwise_cosine", ascending=False)


# ---------- charts ----------
def chart_lex_vs_sem(cmp: pd.DataFrame):
    fig, ax = plt.subplots(figsize=(11, 5))
    x = np.arange(len(cmp))
    ax.bar(x - 0.2, cmp["lexical_hits"], width=0.4, label="Lexical (regex)", color="#f59e0b")
    ax.bar(x + 0.2, cmp["semantic_hits"], width=0.4, label="Semantic (embedding ≥0.35)", color="#3b82f6")
    ax.set_xticks(x); ax.set_xticklabels(cmp["facet"], rotation=35, ha="right")
    ax.set_ylabel("# reviews classified"); ax.legend()
    ax.set_title("Lexical vs semantic facet detection — semantic recovers far more mentions")
    for i, r in cmp.iterrows():
        ax.text(i + 0.2, r["semantic_hits"] + 20, f"+{r['sem_only']}", ha="center",
                fontsize=8, color="#1e40af")
    fig.tight_layout(); fig.savefig(CHARTS / "11_lexical_vs_semantic_facet.png", dpi=130); plt.close(fig)


def chart_drift_heatmap(drift_df: pd.DataFrame):
    pivot = drift_df.pivot(index="eg_property_id", columns="facet", values="mean_cos")[FACETS]
    fig, ax = plt.subplots(figsize=(12, 6))
    im = ax.imshow(pivot.values, aspect="auto", cmap="RdYlGn", vmin=0.1, vmax=0.6)
    ax.set_xticks(range(len(FACETS))); ax.set_xticklabels(FACETS, rotation=40, ha="right")
    ax.set_yticks(range(len(pivot.index))); ax.set_yticklabels(pivot.index)
    for i in range(pivot.shape[0]):
        for j in range(pivot.shape[1]):
            v = pivot.values[i, j]
            if not np.isnan(v):
                ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=7,
                        color="white" if v < 0.3 else "black")
    plt.colorbar(im, ax=ax, label="Mean cosine (listing ↔ reviews)")
    ax.set_title("Listing ↔ Review semantic drift — low values = listing claims not echoed in reviews")
    fig.tight_layout(); fig.savefig(CHARTS / "12_listing_review_drift_heatmap.png", dpi=130); plt.close(fig)


def chart_matched_drift_heatmap(drift_df: pd.DataFrame):
    pivot = drift_df.pivot(index="eg_property_id", columns="facet", values="mean_cos_matched_reviews")[FACETS]
    fig, ax = plt.subplots(figsize=(12, 6))
    im = ax.imshow(pivot.values, aspect="auto", cmap="RdYlGn", vmin=0.1, vmax=0.8)
    ax.set_xticks(range(len(FACETS))); ax.set_xticklabels(FACETS, rotation=40, ha="right")
    ax.set_yticks(range(len(pivot.index))); ax.set_yticklabels(pivot.index)
    for i in range(pivot.shape[0]):
        for j in range(pivot.shape[1]):
            v = pivot.values[i, j]
            if not np.isnan(v):
                ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=7,
                        color="white" if v < 0.35 else "black")
    plt.colorbar(im, ax=ax, label="Mean cosine (listing ↔ facet-matched reviews)")
    ax.set_title("Listing ↔ facet-matched review cosine — stronger support than all-review drift")
    fig.tight_layout(); fig.savefig(CHARTS / "17_listing_review_drift_matched_heatmap.png", dpi=130); plt.close(fig)


def chart_thresholds(threshold_df: pd.DataFrame):
    thresh = threshold_df[threshold_df["threshold_type"] == "selected"].sort_values("threshold")
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.barh(range(len(thresh)), thresh["threshold"], color="#0ea5e9")
    ax.set_yticks(range(len(thresh))); ax.set_yticklabels(thresh["facet"])
    ax.set_xlabel("Chosen semantic threshold")
    ax.set_title("Facet-specific semantic thresholds for audit-grade precision")
    for i, v in enumerate(thresh["threshold"]):
        ax.text(v + 0.005, i, f"{v:.2f}", va="center", fontsize=9)
    fig.tight_layout(); fig.savefig(CHARTS / "18_semantic_thresholds.png", dpi=130); plt.close(fig)


def chart_clusters_pca(rev: pd.DataFrame, rev_emb: np.ndarray, labels: np.ndarray):
    pca = PCA(n_components=2, random_state=0)
    xy = pca.fit_transform(rev_emb)
    fig, ax = plt.subplots(figsize=(10, 7))
    sc = ax.scatter(xy[:, 0], xy[:, 1], c=labels, cmap="tab20", s=4, alpha=0.5)
    ax.set_title("Review embedding clusters (KMeans k=14, PCA 2D) — unsupervised topic map")
    ax.set_xlabel("PC1"); ax.set_ylabel("PC2")
    fig.tight_layout(); fig.savefig(CHARTS / "13_review_clusters_pca.png", dpi=130); plt.close(fig)


def chart_temporal_drift(tdrift: pd.DataFrame):
    fig, ax = plt.subplots(figsize=(10, 5))
    tdrift = tdrift.sort_values("drift", ascending=True)
    colors = ["#10b981" if d < 0.08 else "#f59e0b" if d < 0.15 else "#ef4444" for d in tdrift["drift"]]
    ax.barh(range(len(tdrift)), tdrift["drift"], color=colors)
    ax.set_yticks(range(len(tdrift)))
    ax.set_yticklabels([f"{pid[:10]}… ({r['first_quarter']}→{r['last_quarter']})"
                        for pid, r in zip(tdrift["eg_property_id"], tdrift.to_dict("records"))])
    ax.set_xlabel("1 − cosine(first-quarter centroid, last-quarter centroid)")
    ax.set_title("Temporal drift: how much has review content shifted over time, per property")
    fig.tight_layout(); fig.savefig(CHARTS / "14_temporal_drift.png", dpi=130); plt.close(fig)


def chart_redundancy(red: pd.DataFrame):
    fig, ax = plt.subplots(figsize=(10, 5))
    red = red.sort_values("mean_pairwise_cosine", ascending=True)
    ax.barh(range(len(red)), red["mean_pairwise_cosine"], color="#8b5cf6")
    ax.set_yticks(range(len(red)))
    ax.set_yticklabels([pid[:14] + "…" for pid in red["eg_property_id"]])
    ax.set_xlabel("Mean pairwise cosine (150-sample)")
    ax.set_title("Review redundancy per property — high = reviewers echo each other → follow-up most valuable")
    fig.tight_layout(); fig.savefig(CHARTS / "15_redundancy_per_property.png", dpi=130); plt.close(fig)


def chart_facet_score_distributions(sem_scores: pd.DataFrame):
    fig, axes = plt.subplots(2, 5, figsize=(16, 7))
    for ax, facet in zip(axes.flat, FACETS):
        ax.hist(sem_scores[facet], bins=40, color="#0ea5e9")
        ax.axvline(0.35, color="red", linestyle="--", linewidth=1)
        ax.set_title(facet, fontsize=10)
        ax.set_xlim(0, 0.8)
    fig.suptitle("Semantic facet score distributions (cosine to facet prototypes); red = decision threshold")
    fig.tight_layout(); fig.savefig(CHARTS / "16_semantic_score_distributions.png", dpi=130); plt.close(fig)


# ---------- main ----------
def main():
    print(">> Loading data...")
    desc, rev = load_data()
    print(f"   {len(rev)} reviews with ≥10 chars, {len(desc)} properties")

    print(">> Embedding reviews...")
    rev_emb = embed_batch(rev["full_text"].tolist(), "reviews_v1")
    print(f"   shape={rev_emb.shape}")

    print(">> Embedding facet prototypes...")
    proto_emb_by_facet = {}
    for facet, protos in FACET_PROTOTYPES.items():
        proto_emb_by_facet[facet] = embed_batch(protos, f"proto_{facet}")

    print(">> Embedding anti-claims...")
    anti_texts = [ANTI_CLAIMS[f] for f in FACETS]
    anti_emb_arr = embed_batch(anti_texts, "anticlaims_v1")
    anti_emb = {f: anti_emb_arr[i] for i, f in enumerate(FACETS)}

    print(">> Embedding positive facet claims...")
    positive_emb = {}
    for facet, texts in POSITIVE_CLAIMS.items():
        positive_emb[facet] = embed_batch(texts, f"positive_{facet}")

    print(">> Embedding listing facet docs...")
    listing_docs = build_listing_docs(desc)
    flat_texts, flat_keys = [], []
    for pid, fd in listing_docs.items():
        for facet, text in fd.items():
            if text:
                flat_texts.append(text); flat_keys.append((pid, facet))
    flat_emb = embed_batch(flat_texts, "listing_v1")
    listing_emb_by_facet: dict[str, dict[str, np.ndarray]] = {pid: {} for pid in desc["eg_property_id"]}
    for (pid, facet), vec in zip(flat_keys, flat_emb):
        listing_emb_by_facet[pid][facet] = vec

    print(">> Semantic facet scores...")
    sem_scores = semantic_facet_scores(rev_emb, proto_emb_by_facet)
    sem_scores.insert(0, "eg_property_id", rev["eg_property_id"].values)
    sem_scores.insert(1, "acquisition_date", rev["acquisition_date"].values)
    sem_score_path = write_table(sem_scores, ARTIFACTS / "semantic_facet_scores.parquet")
    print(f"   wrote semantic scores to {sem_score_path.name}")

    print(">> Compare lexical vs semantic...")
    # align rows: lexical was built over ALL rows; here rev was filtered to len>=10
    # so we rebuild a hits frame by re-running regex on current rev
    from run_eda import FACET_LEXICON
    txt = (rev["review_title"].str.lower() + " " + rev["review_text"].str.lower())
    lex_hits = pd.DataFrame({f: txt.str.contains(p, regex=True, na=False).astype(int)
                             for f, p in FACET_LEXICON.items() if f in FACETS})
    cmp = compare_lexical_vs_semantic(rev, sem_scores[FACETS], lex_hits)
    cmp.to_csv(ARTIFACTS / "lexical_vs_semantic.csv", index=False)
    print(cmp.to_string())

    print(">> Calibrating semantic thresholds...")
    threshold_df, thresholds = threshold_sweep(sem_scores[FACETS], lex_hits)
    selected_threshold_df = pd.DataFrame({
        "facet": FACETS,
        "threshold": [thresholds[f] for f in FACETS],
        "threshold_type": "selected",
    })
    threshold_df = pd.concat([threshold_df, selected_threshold_df], ignore_index=True)
    threshold_df.to_csv(ARTIFACTS / "semantic_threshold_sweep.csv", index=False)
    selected_threshold_df.to_csv(ARTIFACTS / "semantic_thresholds.csv", index=False)
    sem_hits_dynamic = classify_semantic_hits(sem_scores[FACETS], thresholds)
    audit = semantic_audit_samples(rev, sem_scores[FACETS], lex_hits, thresholds)
    audit.to_csv(ARTIFACTS / "semantic_audit_samples.csv", index=False)

    print(">> Listing↔review drift...")
    drift = listing_review_drift(desc, rev, listing_emb_by_facet, rev_emb)
    drift.to_csv(ARTIFACTS / "listing_review_drift.csv", index=False)
    drift_matched = listing_review_drift_matched(rev, sem_scores[FACETS], thresholds, listing_emb_by_facet, rev_emb)
    drift_matched.to_csv(ARTIFACTS / "listing_review_drift_matched.csv", index=False)

    print(">> Anti-claim conflict discovery...")
    conflict = anti_claim_conflict(rev, rev_emb, anti_emb, listing_emb_by_facet, top_k=3)
    conflict.head(80).to_csv(ARTIFACTS / "semantic_conflict_top.csv", index=False)
    validated_conflict = validated_anti_claim_conflict(
        rev=rev,
        rev_emb=rev_emb,
        sem_scores=sem_scores[FACETS],
        thresholds=thresholds,
        anti_emb=anti_emb,
        positive_emb=positive_emb,
        listing_emb_by_facet=listing_emb_by_facet,
        top_k=5,
    )
    validated_conflict.head(120).to_csv(ARTIFACTS / "semantic_conflict_validated.csv", index=False)

    print(">> Topic discovery via KMeans...")
    labels, centroids, clusters = discover_topics(rev, rev_emb, k=14)
    clusters.to_json(ARTIFACTS / "topic_clusters.json", orient="records", indent=2)

    print(">> Temporal drift...")
    tdrift = temporal_drift(rev, rev_emb)
    tdrift.to_csv(ARTIFACTS / "temporal_drift.csv", index=False)

    print(">> Redundancy per property...")
    red = redundancy_per_property(rev, rev_emb)
    red.to_csv(ARTIFACTS / "redundancy_per_property.csv", index=False)

    print(">> Charts...")
    chart_lex_vs_sem(cmp)
    chart_drift_heatmap(drift)
    chart_matched_drift_heatmap(drift_matched)
    chart_clusters_pca(rev, rev_emb, labels)
    chart_temporal_drift(tdrift)
    chart_redundancy(red)
    chart_facet_score_distributions(sem_scores[FACETS])
    chart_thresholds(threshold_df)

    summary = {
        "reviews_embedded": int(len(rev)),
        "embedding_model": MODEL,
        "lexical_vs_semantic": cmp.to_dict(orient="records"),
        "semantic_thresholds": thresholds,
        "avg_listing_review_cosine_overall": float(drift["mean_cos"].mean()) if len(drift) else None,
        "avg_listing_review_cosine_matched": float(drift_matched["mean_cos_matched_reviews"].dropna().mean()) if len(drift_matched) else None,
        "facets_with_biggest_drift": drift.groupby("facet")["mean_cos"].mean().sort_values().head(5).to_dict(),
        "facets_with_lowest_matched_support": drift_matched.groupby("facet")["mean_cos_matched_reviews"].mean().sort_values().head(5).to_dict(),
        "top_semantic_conflicts": conflict.head(10).drop(columns=["review_idx"], errors="ignore").to_dict(orient="records") if len(conflict) else [],
        "top_validated_semantic_conflicts": validated_conflict.head(10).drop(columns=["review_idx"], errors="ignore").to_dict(orient="records") if len(validated_conflict) else [],
        "temporal_drift_max": tdrift.head(3).to_dict(orient="records") if len(tdrift) else [],
        "redundancy_max": red.head(3).to_dict(orient="records") if len(red) else [],
        "semantic_audit_rows": int(len(audit)),
        "kmeans_cluster_sizes": [int(x) for x in pd.Series(labels).value_counts().sort_index().values],
    }
    (ARTIFACTS / "semantic_summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print(">> Done.")
    print("Summary:", json.dumps({k: v for k, v in summary.items() if k not in ("top_semantic_conflicts", "lexical_vs_semantic")},
                                 indent=2, default=str))


if __name__ == "__main__":
    main()
