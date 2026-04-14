"""ReviewGap EDA pipeline.

Generates charts, data artifacts, and findings from Description_PROC.csv and
Reviews_PROC.csv. Single entry point: `python EDA/scripts/run_eda.py`.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "EDA"
CHARTS = OUT / "charts"
ARTIFACTS = OUT / "data_artifacts"
FINDINGS = OUT / "findings"
for p in (CHARTS, ARTIFACTS, FINDINGS):
    p.mkdir(parents=True, exist_ok=True)

TODAY = pd.Timestamp("2026-04-13")

FACET_LEXICON = {
    "pet": r"\b(pet|pets|dog|dogs|cat|cats|animal|puppy|kitten|service animal)\b",
    "check_in": r"\b(check.?in|checkin|front desk|arriv(?:al|ed|ing)|reception|lobby|key|keycard|room key)\b",
    "check_out": r"\b(check.?out|checkout|depart(?:ure|ed|ing)|late check|early check)\b",
    "amenities_pool": r"\b(pool|swimming|hot tub|jacuzzi|spa)\b",
    "amenities_wifi": r"\b(wifi|wi-fi|internet|connection|bandwidth)\b",
    "amenities_breakfast": r"\b(breakfast|buffet|continental|morning meal)\b",
    "amenities_parking": r"\b(parking|valet|garage|lot)\b",
    "amenities_gym": r"\b(gym|fitness|workout|exercise)\b",
    "children_extra_bed": r"\b(kid|kids|child|children|crib|cot|extra bed|rollaway|family)\b",
    "know_before_you_go": r"\b(construction|renovation|noise|noisy|loud|fee|charge|deposit|unexpected)\b",
    "cleanliness": r"\b(clean|dirty|stain|smell|odor|spotless|filthy|dust|mold)\b",
    "staff": r"\b(staff|service|friendly|rude|helpful|manager|concierge)\b",
    "location": r"\b(location|near|walking distance|close to|far from|neighborhood)\b",
    "room": r"\b(room|bed|bathroom|shower|bath|tv|ac|air condition|heat)\b",
}

POS_CUES = {"clean", "great", "good", "excellent", "friendly", "helpful", "nice", "comfortable",
            "perfect", "amazing", "love", "loved", "open", "smooth", "easy", "fast", "quiet",
            "spotless", "wonderful"}
NEG_CUES = {"dirty", "bad", "terrible", "rude", "unfriendly", "slow", "noisy", "broken", "closed",
            "stain", "stained", "smelly", "smell", "odor", "filthy", "mold", "disappointed",
            "awful", "horrible", "worst", "never", "unexpected", "fee", "extra charge"}

FACETS_MVP = ["pet", "check_in", "check_out", "amenities_pool", "amenities_wifi",
              "amenities_breakfast", "amenities_parking", "amenities_gym",
              "children_extra_bed", "know_before_you_go"]


def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    desc = pd.read_csv(DATA / "Description_PROC.csv")
    rev = pd.read_csv(DATA / "Reviews_PROC.csv")
    rev["acquisition_date"] = pd.to_datetime(rev["acquisition_date"], format="%m/%d/%y", errors="coerce")
    ratings = rev["rating"].fillna("{}").apply(lambda s: json.loads(s) if isinstance(s, str) else {})
    rating_df = pd.json_normalize(ratings)
    rating_df.columns = [f"rating_{c}" for c in rating_df.columns]
    rev = pd.concat([rev.reset_index(drop=True), rating_df.reset_index(drop=True)], axis=1)
    rev["review_text"] = rev["review_text"].fillna("")
    rev["review_title"] = rev["review_title"].fillna("")
    rev["text_len"] = rev["review_text"].str.len()
    rev["title_len"] = rev["review_title"].str.len()
    return desc, rev


def profile(desc: pd.DataFrame, rev: pd.DataFrame) -> dict:
    return {
        "n_properties": int(desc["eg_property_id"].nunique()),
        "n_reviews": int(len(rev)),
        "date_min": str(rev["acquisition_date"].min().date()),
        "date_max": str(rev["acquisition_date"].max().date()),
        "empty_title_pct": float((rev["review_title"].str.len() == 0).mean() * 100),
        "empty_text_pct": float((rev["review_text"].str.len() == 0).mean() * 100),
        "text_len_mean": float(rev["text_len"].mean()),
        "text_len_median": float(rev["text_len"].median()),
        "per_prop_count_min": int(rev.groupby("eg_property_id").size().min()),
        "per_prop_count_max": int(rev.groupby("eg_property_id").size().max()),
        "per_prop_count_median": int(rev.groupby("eg_property_id").size().median()),
    }


def facet_mentions(rev: pd.DataFrame) -> pd.DataFrame:
    txt = (rev["review_title"].str.lower() + " " + rev["review_text"].str.lower())
    hits = {}
    for facet, pat in FACET_LEXICON.items():
        hits[facet] = txt.str.contains(pat, regex=True, na=False).astype(int)
    fm = pd.DataFrame(hits)
    fm.insert(0, "eg_property_id", rev["eg_property_id"].values)
    fm.insert(1, "acquisition_date", rev["acquisition_date"].values)
    return fm


def facet_sentiment(rev: pd.DataFrame, fm: pd.DataFrame) -> pd.DataFrame:
    """For each review x facet with a hit, compute pos/neg cue count on the text."""
    txt = (rev["review_title"].str.lower() + " " + rev["review_text"].str.lower())
    tokens = txt.str.findall(r"[a-z']+")
    pos = tokens.apply(lambda ts: sum(1 for t in ts if t in POS_CUES))
    neg = tokens.apply(lambda ts: sum(1 for t in ts if t in NEG_CUES))
    sent = pd.DataFrame({
        "eg_property_id": rev["eg_property_id"].values,
        "acquisition_date": rev["acquisition_date"].values,
        "pos": pos.values,
        "neg": neg.values,
        "rating_overall": rev.get("rating_overall", pd.Series([np.nan] * len(rev))).values,
    })
    return sent


# -------------------------- CHARTS --------------------------

def chart_review_volume(rev: pd.DataFrame):
    fig, ax = plt.subplots(figsize=(11, 5))
    monthly = rev.set_index("acquisition_date").groupby(
        [pd.Grouper(freq="ME"), "eg_property_id"]).size().unstack(fill_value=0)
    monthly.plot.area(ax=ax, legend=False, alpha=0.7, linewidth=0)
    ax.set_title("Monthly review volume by property (Feb 2023 – Feb 2026)")
    ax.set_xlabel("Month"); ax.set_ylabel("Reviews")
    fig.tight_layout(); fig.savefig(CHARTS / "01_review_volume_over_time.png", dpi=130); plt.close(fig)


def chart_reviews_per_property(rev: pd.DataFrame):
    counts = rev.groupby("eg_property_id").size().sort_values(ascending=True)
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.barh(range(len(counts)), counts.values, color="#3b82f6")
    ax.set_yticks(range(len(counts)))
    ax.set_yticklabels(counts.index)
    ax.set_xscale("log")
    ax.set_xlabel("Review count (log)"); ax.set_title("Reviews per property (8 → 1,094)")
    fig.tight_layout(); fig.savefig(CHARTS / "02_reviews_per_property.png", dpi=130); plt.close(fig)


def chart_review_length(rev: pd.DataFrame):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    nonzero = rev[rev["text_len"] > 0]["text_len"]
    axes[0].hist(nonzero, bins=60, color="#0ea5e9")
    axes[0].set_title(f"Review text length (n={len(nonzero)}, median={int(nonzero.median())} chars)")
    axes[0].set_xlabel("chars"); axes[0].set_ylabel("reviews")
    axes[1].hist(rev["title_len"], bins=30, color="#f59e0b")
    axes[1].set_title(f"Review title length (empty rate = {(rev['title_len']==0).mean()*100:.1f}%)")
    axes[1].set_xlabel("chars")
    fig.tight_layout(); fig.savefig(CHARTS / "03_review_length_distribution.png", dpi=130); plt.close(fig)


def chart_overall_rating(rev: pd.DataFrame):
    r = rev["rating_overall"].dropna()
    r = r[r > 0]
    fig, ax = plt.subplots(figsize=(7, 4))
    counts = r.round().value_counts().sort_index()
    ax.bar(counts.index.astype(int).astype(str), counts.values, color="#10b981")
    ax.set_title("Overall rating distribution (excluding 0 = no rating)")
    ax.set_xlabel("Stars"); ax.set_ylabel("Reviews")
    fig.tight_layout(); fig.savefig(CHARTS / "04_overall_rating_distribution.png", dpi=130); plt.close(fig)


def chart_rating_subdim_coverage(rev: pd.DataFrame):
    rating_cols = [c for c in rev.columns if c.startswith("rating_")]
    coverage = (rev[rating_cols] > 0).mean().sort_values(ascending=True) * 100
    fig, ax = plt.subplots(figsize=(9, 6))
    ax.barh(range(len(coverage)), coverage.values, color="#8b5cf6")
    ax.set_yticks(range(len(coverage)))
    ax.set_yticklabels([c.replace("rating_", "") for c in coverage.index])
    ax.set_xlabel("% reviews with non-zero rating")
    ax.set_title("Rating sub-dimension coverage — most sub-dims are unfilled")
    fig.tight_layout(); fig.savefig(CHARTS / "05_rating_subdimension_coverage.png", dpi=130); plt.close(fig)


def chart_facet_mention_rates(fm: pd.DataFrame):
    rates = fm[FACETS_MVP].mean().sort_values(ascending=True) * 100
    fig, ax = plt.subplots(figsize=(9, 5))
    colors = ["#ef4444" if r < 10 else "#f59e0b" if r < 25 else "#10b981" for r in rates.values]
    ax.barh(range(len(rates)), rates.values, color=colors)
    ax.set_yticks(range(len(rates))); ax.set_yticklabels(rates.index)
    ax.set_xlabel("% of reviews mentioning facet")
    ax.set_title("Facet coverage across all reviews (red = gap, green = well-covered)")
    for i, v in enumerate(rates.values):
        ax.text(v + 0.3, i, f"{v:.1f}%", va="center", fontsize=9)
    fig.tight_layout(); fig.savefig(CHARTS / "06_facet_mention_rates.png", dpi=130); plt.close(fig)


def chart_staleness_heatmap(fm: pd.DataFrame) -> pd.DataFrame:
    """Returns the freshness DataFrame used elsewhere."""
    rows = []
    for pid, g in fm.groupby("eg_property_id"):
        for facet in FACETS_MVP:
            hits = g[g[facet] == 1]
            last = hits["acquisition_date"].max() if len(hits) else pd.NaT
            days = (TODAY - last).days if pd.notna(last) else 9999
            count_90 = int(((TODAY - g.loc[g[facet] == 1, "acquisition_date"]).dt.days <= 90).sum())
            rows.append({"eg_property_id": pid, "facet": facet,
                         "last_mention_date": last, "days_since": days,
                         "mention_count_90d": count_90,
                         "total_mentions": int(hits.shape[0]),
                         "total_reviews": int(g.shape[0]),
                         "mention_rate": float(hits.shape[0] / max(g.shape[0], 1))})
    freshness = pd.DataFrame(rows)
    pivot = freshness.pivot(index="eg_property_id", columns="facet", values="days_since")[FACETS_MVP]
    fig, ax = plt.subplots(figsize=(12, 6))
    data = pivot.clip(upper=720).values
    im = ax.imshow(data, aspect="auto", cmap="RdYlGn_r")
    ax.set_xticks(range(len(FACETS_MVP))); ax.set_xticklabels(FACETS_MVP, rotation=40, ha="right")
    ax.set_yticks(range(len(pivot.index))); ax.set_yticklabels(pivot.index)
    for i in range(data.shape[0]):
        for j in range(data.shape[1]):
            v = pivot.values[i, j]
            label = f"{int(v)}d" if v < 9999 else "never"
            ax.text(j, i, label, ha="center", va="center", fontsize=7,
                    color="white" if data[i, j] > 360 else "black")
    plt.colorbar(im, ax=ax, label="Days since last mention (capped 720)")
    ax.set_title("Facet staleness heatmap — days since last review mention per property × facet")
    fig.tight_layout(); fig.savefig(CHARTS / "07_facet_staleness_heatmap.png", dpi=130); plt.close(fig)
    return freshness


def chart_sentiment_conflict(sent: pd.DataFrame, fm: pd.DataFrame) -> pd.DataFrame:
    # per (property, facet) negative-mention share conditional on mention
    rows = []
    for facet in FACETS_MVP:
        mask = fm[facet] == 1
        if mask.sum() < 5:
            continue
        sub = sent[mask].copy()
        sub["neg_heavy"] = (sub["neg"] > sub["pos"]).astype(int)
        for pid, g in sub.groupby("eg_property_id"):
            if len(g) >= 5:
                rate = g["neg_heavy"].mean()
                # Beta(alpha, beta) posterior with prior (1,1), threshold>0.3
                alpha = 1 + g["neg_heavy"].sum()
                beta = 1 + (len(g) - g["neg_heavy"].sum())
                p_over_30 = 1 - _beta_cdf(0.3, alpha, beta)
                rows.append({"eg_property_id": pid, "facet": facet,
                             "n_mentions": len(g), "neg_rate": rate,
                             "p_neg_over_30pct": p_over_30})
    conflict = pd.DataFrame(rows).sort_values("p_neg_over_30pct", ascending=False)
    # scatter
    fig, ax = plt.subplots(figsize=(10, 5))
    if len(conflict):
        ax.scatter(conflict["n_mentions"], conflict["neg_rate"] * 100,
                   s=50, c=conflict["p_neg_over_30pct"], cmap="Reds", edgecolor="black")
        for _, r in conflict.head(8).iterrows():
            ax.annotate(f"{r['eg_property_id']}/{r['facet']}",
                        (r["n_mentions"], r["neg_rate"] * 100), fontsize=7)
    ax.set_xlabel("Mentions of facet (n)"); ax.set_ylabel("Negative-share %")
    ax.set_title("Conflict candidates: property × facet with high negative-mention share")
    fig.tight_layout(); fig.savefig(CHARTS / "08_sentiment_vs_rating_conflict.png", dpi=130); plt.close(fig)
    return conflict


def _beta_cdf(x, a, b):
    # regularized incomplete beta via scipy-free approximation (Monte Carlo)
    rng = np.random.default_rng(0)
    draws = rng.beta(a, b, size=5000)
    return float((draws <= x).mean())


def chart_topic_coverage(fm: pd.DataFrame, desc: pd.DataFrame):
    rates = fm.groupby("eg_property_id")[FACETS_MVP].mean() * 100
    fig, ax = plt.subplots(figsize=(13, 6))
    rates.plot(kind="bar", stacked=False, ax=ax, width=0.8, colormap="tab20")
    ax.set_ylabel("% reviews mentioning facet")
    ax.set_title("Per-property facet mention rates — reveals what reviewers actually talk about")
    ax.legend(bbox_to_anchor=(1.01, 1), loc="upper left", fontsize=8)
    fig.tight_layout(); fig.savefig(CHARTS / "09_topic_coverage_by_property.png", dpi=130); plt.close(fig)


def chart_empty_title(rev: pd.DataFrame):
    empty = (rev["title_len"] == 0).mean() * 100
    nonempty = 100 - empty
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.bar(["Empty title", "Has title"], [empty, nonempty], color=["#ef4444", "#10b981"])
    for i, v in enumerate([empty, nonempty]):
        ax.text(i, v + 1, f"{v:.1f}%", ha="center", fontweight="bold")
    ax.set_ylabel("% of reviews"); ax.set_ylim(0, 105)
    ax.set_title("92.7% of reviews have empty titles — natural spot for the follow-up UI")
    fig.tight_layout(); fig.savefig(CHARTS / "10_empty_title_rate.png", dpi=130); plt.close(fig)


# -------------------------- MAIN --------------------------

def main():
    print(">> Loading data...")
    desc, rev = load()
    prof = profile(desc, rev)
    print(json.dumps(prof, indent=2))

    print(">> Facet mention detection...")
    fm = facet_mentions(rev)
    fm.to_parquet(ARTIFACTS / "facet_mentions.parquet", index=False)
    print(">> Sentiment...")
    sent = facet_sentiment(rev, fm)

    print(">> Charts...")
    chart_review_volume(rev)
    chart_reviews_per_property(rev)
    chart_review_length(rev)
    chart_overall_rating(rev)
    chart_rating_subdim_coverage(rev)
    chart_facet_mention_rates(fm)
    freshness = chart_staleness_heatmap(fm)
    conflict = chart_sentiment_conflict(sent, fm)
    chart_topic_coverage(fm, desc)
    chart_empty_title(rev)

    freshness.to_csv(ARTIFACTS / "property_facet_freshness.csv", index=False)
    conflict.to_csv(ARTIFACTS / "conflict_candidates.csv", index=False)

    # Summary JSON for README
    summary = {
        "profile": prof,
        "facet_overall_mention_rates_pct": (fm[FACETS_MVP].mean() * 100).round(2).to_dict(),
        "n_stale_cells_gt_180d": int((freshness["days_since"] > 180).sum()),
        "n_conflict_candidates_p_over_0_5": int((conflict["p_neg_over_30pct"] > 0.5).sum()) if len(conflict) else 0,
        "top_conflict": conflict.head(5).to_dict(orient="records") if len(conflict) else [],
    }
    (ARTIFACTS / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print(">> Done.")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
