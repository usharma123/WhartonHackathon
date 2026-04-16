from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

import experiment_config as cfg

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
ARTIFACTS = ROOT / "EDA" / "data_artifacts"
RUNTIME = ARTIFACTS / "runtime"
MANUAL = ARTIFACTS / "manual_ranker_benchmark"
RUNTIME.mkdir(parents=True, exist_ok=True)
MANUAL.mkdir(parents=True, exist_ok=True)

FACETS = [
    "check_in",
    "check_out",
    "amenities_breakfast",
    "amenities_parking",
    "know_before_you_go",
    "amenities_pool",
]
ELIGIBLE_RELIABILITY = {"high", "medium"}
LOOKAHEAD_DAYS = 180
MIN_PRIOR_REVIEWS = 10
MIN_FUTURE_REVIEWS = 3
RANDOM_STATE = 42

FACET_LISTING_FIELDS = {
    "check_in": ["check_in_start_time", "check_in_end_time", "check_in_instructions"],
    "check_out": ["check_out_time", "check_out_policy"],
    "amenities_breakfast": [
        "property_description",
        "popular_amenities_list",
        "property_amenity_food_and_drink",
    ],
    "amenities_parking": [
        "popular_amenities_list",
        "property_amenity_parking",
        "know_before_you_go",
    ],
    "know_before_you_go": ["know_before_you_go"],
    "amenities_pool": [
        "popular_amenities_list",
        "property_amenity_things_to_do",
        "know_before_you_go",
    ],
}


@dataclass
class SnapshotBundle:
    snapshots: pd.DataFrame
    reviews: pd.DataFrame
    descriptions: pd.DataFrame
    thresholds: dict[str, float]


def clean_text(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                text = "; ".join(str(item) for item in parsed if item)
        except json.JSONDecodeError:
            pass
    text = re.sub(r"<br\s*/?>", ". ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ,;")


def clamp(value: float, min_value: float = 0.0, max_value: float = 1.0) -> float:
    return max(min_value, min(max_value, value))


def staleness_score(days_since: int) -> float:
    if days_since >= 9999:
        return 1.0
    return round(min(days_since / cfg.STALENESS_NORM_DAYS, 1.0), 4)


def compute_reliability(
    facet: str,
    matched_review_rate: float,
    mean_cos_matched_reviews: float,
    validated_conflict_count: int,
    mention_rate: float,
    has_listing_text: bool,
) -> str:
    if not has_listing_text:
        return "low"
    if validated_conflict_count > 0 or matched_review_rate >= cfg.RELIABILITY_HIGH_MATCHED_RATE:
        return "high"
    if (
        mean_cos_matched_reviews >= cfg.RELIABILITY_MEDIUM_COS
        and matched_review_rate >= cfg.RELIABILITY_MEDIUM_MATCHED_RATE
    ) or mention_rate >= cfg.RELIABILITY_MEDIUM_MENTION_RATE:
        return "medium"
    return "low"


def matched_support(mention_rate: float, mean_cos_matched_reviews: float) -> float:
    if mention_rate <= 0 or mean_cos_matched_reviews <= 0:
        return 0.0
    return clamp(mean_cos_matched_reviews)


def heuristic_score(row: dict[str, float] | pd.Series) -> float:
    support_gap = 1 - matched_support(
        float(row["matchedReviewRate"]), float(row["meanCosMatchedReviews"])
    )
    conflict = clamp(float(row["validatedConflictScore"]) / 0.08)
    return float(
        round(
            float(row["importance"]) * 0.25
            + float(row["stalenessScore"]) * 0.25
            + conflict * 0.20
            + (1 - float(row["mentionRate"])) * 0.15
            + support_gap * 0.15,
            6,
        )
    )


def build_listing_text(description_row: pd.Series, facet: str) -> str:
    parts: list[str] = []
    for field in FACET_LISTING_FIELDS[facet]:
        value = clean_text(description_row.get(field, ""))
        if value:
            parts.append(f"{field}: {value}")
    return " | ".join(parts)


def parse_overall_rating(raw: object) -> float | None:
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    try:
        parsed = json.loads(str(raw))
    except json.JSONDecodeError:
        return None
    value = parsed.get("overall") if isinstance(parsed, dict) else None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def truncate_review_text(text: str) -> str:
    text = clean_text(text)
    if not text:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    kept = [sentence.strip() for sentence in sentences if sentence.strip()]
    if not kept:
        return text[:180]
    draft = " ".join(kept[:2]).strip()
    if len(draft) > 220:
        draft = draft[:220].rsplit(" ", 1)[0]
    return draft


def draft_sentiment_label(overall_rating: float | None) -> str:
    if overall_rating is None:
        return "neutral"
    if overall_rating >= 4.5:
        return "positive"
    if overall_rating <= 2.5:
        return "negative"
    return "neutral"


def load_reviews_with_scores() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, float], pd.DataFrame]:
    descriptions = pd.read_csv(DATA / "Description_PROC.csv")
    descriptions = descriptions.rename(columns=str.strip)
    reviews = pd.read_csv(DATA / "Reviews_PROC.csv")
    scores = pd.read_csv(ARTIFACTS / "semantic_facet_scores.csv")
    thresholds = pd.read_csv(ARTIFACTS / "semantic_thresholds.csv")
    conflicts = pd.read_csv(ARTIFACTS / "semantic_conflict_validated.csv")

    reviews["acquisition_date"] = pd.to_datetime(reviews["acquisition_date"], errors="coerce")
    scores["acquisition_date"] = pd.to_datetime(scores["acquisition_date"], errors="coerce")
    reviews = reviews.dropna(subset=["acquisition_date"]).reset_index(drop=True)
    scores = scores.dropna(subset=["acquisition_date"]).reset_index(drop=True)
    reviews["dup_ix"] = reviews.groupby(["eg_property_id", "acquisition_date"]).cumcount()
    scores["dup_ix"] = scores.groupby(["eg_property_id", "acquisition_date"]).cumcount()
    merged = reviews.merge(
        scores,
        on=["eg_property_id", "acquisition_date", "dup_ix"],
        how="inner",
        validate="one_to_one",
    )
    merged["review_title"] = merged["review_title"].fillna("")
    merged["review_text"] = merged["review_text"].fillna("")
    merged["full_text"] = (
        merged["review_title"].astype(str).str.strip()
        + ". "
        + merged["review_text"].astype(str).str.strip()
    ).str.strip(". ").str.strip()
    merged["overall_rating"] = merged["rating"].map(parse_overall_rating)
    merged["draft_sentiment"] = merged["overall_rating"].map(draft_sentiment_label)
    merged["review_month"] = merged["acquisition_date"].dt.to_period("M").dt.to_timestamp()
    threshold_map = dict(zip(thresholds["facet"], thresholds["threshold"]))
    return merged, descriptions.set_index("eg_property_id"), threshold_map, conflicts


def build_temporal_snapshots() -> SnapshotBundle:
    merged, descriptions, thresholds, conflicts = load_reviews_with_scores()
    snapshot_rows: list[dict[str, object]] = []
    conflicts = conflicts.copy()
    conflicts["acquisition_date"] = pd.to_datetime(conflicts["acquisition_date"], errors="coerce")
    conflicts = conflicts.dropna(subset=["acquisition_date"])

    for property_id, reviews in merged.groupby("eg_property_id", sort=False):
        reviews = reviews.sort_values("acquisition_date").reset_index(drop=True)
        description = descriptions.loc[property_id]
        months = sorted(reviews["review_month"].dropna().unique())
        if not months:
            continue
        for month_start in months:
            cutoff = pd.Timestamp(month_start) + pd.offsets.MonthEnd(0)
            prior = reviews[reviews["acquisition_date"] <= cutoff].copy()
            future_end = cutoff + pd.Timedelta(days=LOOKAHEAD_DAYS)
            future = reviews[
                (reviews["acquisition_date"] > cutoff)
                & (reviews["acquisition_date"] <= future_end)
            ].copy()
            if len(prior) < MIN_PRIOR_REVIEWS or len(future) < MIN_FUTURE_REVIEWS:
                continue
            for facet in FACETS:
                listing_text = build_listing_text(description, facet)
                threshold = float(thresholds[facet])
                prior_support = prior[facet] >= threshold
                future_support = future[facet] >= threshold
                matched_prior = prior.loc[prior_support, facet]
                prior_conflicts = conflicts[
                    (conflicts["eg_property_id"] == property_id)
                    & (conflicts["facet"] == facet)
                    & (conflicts["acquisition_date"] <= cutoff)
                    & (conflicts["validated_conflict_score"] > 0)
                ]
                future_conflicts = conflicts[
                    (conflicts["eg_property_id"] == property_id)
                    & (conflicts["facet"] == facet)
                    & (conflicts["acquisition_date"] > cutoff)
                    & (conflicts["acquisition_date"] <= future_end)
                    & (conflicts["validated_conflict_score"] > 0)
                ]
                mention_rate = float(prior_support.mean()) if len(prior) else 0.0
                if matched_prior.empty:
                    days_since = 9999
                    mean_cos = 0.0
                else:
                    latest_mention = prior.loc[prior_support, "acquisition_date"].max()
                    days_since = int((cutoff - latest_mention).days)
                    mean_cos = float(matched_prior.mean())
                matched_review_rate = mention_rate
                reliability = compute_reliability(
                    facet,
                    matched_review_rate,
                    mean_cos,
                    int(len(prior_conflicts)),
                    mention_rate,
                    bool(listing_text),
                )
                if reliability not in ELIGIBLE_RELIABILITY or not listing_text:
                    continue
                future_first_mention_days = LOOKAHEAD_DAYS
                if future_support.any():
                    first_future_date = future.loc[future_support, "acquisition_date"].min()
                    future_first_mention_days = int((first_future_date - cutoff).days)
                future_freshness_relief = max(
                    0.0,
                    (min(days_since, LOOKAHEAD_DAYS) - future_first_mention_days) / LOOKAHEAD_DAYS,
                )
                representative_review = prior.iloc[-1]
                snapshot_rows.append(
                    {
                        "property_id": property_id,
                        "cutoff_date": cutoff.strftime("%Y-%m-%d"),
                        "group_id": f"{property_id}|{cutoff.strftime('%Y-%m-%d')}",
                        "facet": facet,
                        "importance": float(cfg.IMPORTANCE[facet]),
                        "daysSince": int(days_since),
                        "stalenessScore": float(staleness_score(days_since)),
                        "mentionRate": mention_rate,
                        "matchedReviewRate": matched_review_rate,
                        "meanCosMatchedReviews": mean_cos,
                        "validatedConflictScore": float(
                            prior_conflicts["validated_conflict_score"].max()
                            if not prior_conflicts.empty
                            else 0.0
                        ),
                        "validatedConflictCount": int(len(prior_conflicts)),
                        "preCutoffReviewCount": int(len(prior)),
                        "listingTextPresent": True,
                        "listingText": listing_text,
                        "reliabilityClass": reliability,
                        "future_conflict_max": float(
                            future_conflicts["validated_conflict_score"].max()
                            if not future_conflicts.empty
                            else 0.0
                        ),
                        "future_support_rate": float(future_support.mean()) if len(future) else 0.0,
                        "future_first_mention_days": int(future_first_mention_days),
                        "future_freshness_relief": float(round(future_freshness_relief, 6)),
                        "recent_review_text": representative_review["full_text"],
                        "recent_review_date": representative_review["acquisition_date"].strftime(
                            "%Y-%m-%d"
                        ),
                        "draft_review": truncate_review_text(representative_review["full_text"]),
                        "draft_sentiment": representative_review["draft_sentiment"],
                        "overall_rating": representative_review["overall_rating"],
                    }
                )

    frame = pd.DataFrame(snapshot_rows)
    if frame.empty:
        raise RuntimeError("No temporal snapshots were generated for the ranker.")
    group_sizes = frame.groupby("group_id")["facet"].transform("count")
    frame = frame[group_sizes >= 2].copy()
    frame["heuristicScore"] = frame.apply(heuristic_score, axis=1)
    return SnapshotBundle(
        snapshots=frame.reset_index(drop=True),
        reviews=merged.reset_index(drop=True),
        descriptions=descriptions,
        thresholds=thresholds,
    )


def assign_temporal_split(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["cutoff_ts"] = pd.to_datetime(frame["cutoff_date"], errors="coerce")
    frame["split"] = "train"
    for property_id, group in frame.groupby("property_id"):
        ordered_cutoffs = sorted(group["cutoff_ts"].dropna().unique())
        if not ordered_cutoffs:
            continue
        test_cutoffs = set(ordered_cutoffs[-max(1, len(ordered_cutoffs) // 3) :])
        mask = (frame["property_id"] == property_id) & (frame["cutoff_ts"].isin(test_cutoffs))
        frame.loc[mask, "split"] = "test"
    return frame.drop(columns=["cutoff_ts"])


def add_utility_columns(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, dict[str, float]]]:
    frame = frame.copy()
    stats: dict[str, dict[str, float]] = {}
    for column in ["future_conflict_max", "future_support_rate", "future_freshness_relief"]:
        train_values = frame.loc[frame["split"] == "train", column].astype(float)
        mean = float(train_values.mean()) if len(train_values) else 0.0
        std = float(train_values.std(ddof=0)) if len(train_values) else 1.0
        if std <= 1e-9:
            std = 1.0
        stats[column] = {"mean": mean, "std": std}
        frame[f"z_{column}"] = (frame[column].astype(float) - mean) / std
    frame["utility"] = (
        frame["z_future_conflict_max"]
        + frame["z_future_support_rate"]
        + frame["z_future_freshness_relief"]
    )
    return frame, stats


def feature_columns(frame: pd.DataFrame) -> list[str]:
    columns = [
        "importance",
        "daysSince",
        "stalenessScore",
        "mentionRate",
        "matchedReviewRate",
        "meanCosMatchedReviews",
        "validatedConflictScore",
        "validatedConflictCount",
        "preCutoffReviewCount",
    ]
    for reliability in ["high", "medium"]:
        column = f"reliability_{reliability}"
        if column not in frame.columns:
            frame[column] = (frame["reliabilityClass"] == reliability).astype(int)
        columns.append(column)
    return columns


def prepare_feature_frame(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    frame = frame.copy()
    frame["reliability_high"] = (frame["reliabilityClass"] == "high").astype(int)
    frame["reliability_medium"] = (frame["reliabilityClass"] == "medium").astype(int)
    columns = feature_columns(frame)
    return frame, columns


def ndcg_at_k(relevances: list[float], scores: list[float], k: int) -> float:
    if not relevances:
        return 0.0
    order = np.argsort(scores)[::-1][:k]
    ideal = np.argsort(relevances)[::-1][:k]
    gains = np.maximum(np.asarray(relevances, dtype=float), 0)

    def dcg(indices: np.ndarray) -> float:
        total = 0.0
        for rank, idx in enumerate(indices, start=1):
            total += gains[idx] / math.log2(rank + 1)
        return total

    actual = dcg(order)
    best = dcg(ideal)
    return 0.0 if best <= 0 else float(actual / best)


def mrr(relevances: list[float], scores: list[float]) -> float:
    order = np.argsort(scores)[::-1]
    best = max(relevances) if relevances else 0.0
    if best <= 0:
        return 0.0
    for rank, idx in enumerate(order, start=1):
        if relevances[idx] >= best:
            return 1.0 / rank
    return 0.0
