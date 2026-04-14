"""ReviewGap — ML feasibility study.

Goal:
    Determine whether the current dataset is strong enough to justify
    pursuing supervised ML beyond deterministic heuristics.

What this script measures:
    1. Can review text predict existing rating labels?
    2. How much of that signal survives realistic evaluation splits:
       - random CV
       - grouped by property
       - temporal holdout
    3. Which candidate tasks look productizable now vs. later?

Outputs:
    - EDA/data_artifacts/ml_feasibility_metrics.csv
    - EDA/data_artifacts/ml_feasibility_summary.json
    - EDA/charts/19_ml_binary_feasibility.png
    - EDA/charts/20_ml_regression_feasibility.png
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    mean_absolute_error,
    roc_auc_score,
)
from sklearn.model_selection import GroupKFold, StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "EDA"
CHARTS = OUT / "charts"
ARTIFACTS = OUT / "data_artifacts"
for p in (CHARTS, ARTIFACTS):
    p.mkdir(parents=True, exist_ok=True)

RANDOM_STATE = 42
TEMPORAL_CUTOFF = pd.Timestamp("2025-01-01")
MIN_TEXT_LEN = 20


def load_reviews() -> pd.DataFrame:
    rev = pd.read_csv(DATA / "Reviews_PROC.csv")
    rev["acquisition_date"] = pd.to_datetime(rev["acquisition_date"], format="%m/%d/%y", errors="coerce")
    rev["review_text"] = rev["review_text"].fillna("")
    rev["review_title"] = rev["review_title"].fillna("")
    rev["full_text"] = (rev["review_title"] + " " + rev["review_text"]).str.strip()
    rev["text_len"] = rev["full_text"].str.len()

    ratings = rev["rating"].fillna("{}").apply(lambda s: json.loads(s) if isinstance(s, str) else {})
    rating_df = pd.json_normalize(ratings)
    rating_df.columns = [f"rating_{c}" for c in rating_df.columns]
    rev = pd.concat([rev.reset_index(drop=True), rating_df.reset_index(drop=True)], axis=1)
    return rev


def build_tasks(rev: pd.DataFrame) -> list[dict]:
    tasks: list[dict] = []
    rating_tasks = [
        ("overall", "rating_overall"),
        ("cleanliness", "rating_roomcleanliness"),
        ("service", "rating_service"),
        ("ecofriendliness", "rating_ecofriendliness"),
    ]
    for short_name, column in rating_tasks:
        if column not in rev.columns:
            continue
        mask = (rev[column].fillna(0) > 0) & (rev["text_len"] >= MIN_TEXT_LEN)
        task_df = rev.loc[mask, ["eg_property_id", "acquisition_date", "full_text", column]].copy()
        if len(task_df) < 500:
            continue
        task_df["y_reg"] = task_df[column].astype(float)
        task_df["y_bin"] = (task_df[column].astype(float) <= 3).astype(int)
        if task_df["y_bin"].sum() < 80:
            continue
        tasks.append({
            "name": short_name,
            "column": column,
            "df": task_df,
        })
    return tasks


def text_regressor() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_df=0.9, strip_accents="unicode")),
        ("model", Ridge(alpha=1.0)),
    ])


def text_property_regressor() -> Pipeline:
    pre = ColumnTransformer([
        ("text", TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_df=0.9, strip_accents="unicode"), "full_text"),
        ("property", OneHotEncoder(handle_unknown="ignore"), ["eg_property_id"]),
    ])
    return Pipeline([
        ("features", pre),
        ("model", Ridge(alpha=1.0)),
    ])


def text_classifier() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_df=0.9, strip_accents="unicode")),
        ("model", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_STATE)),
    ])


def text_property_classifier() -> Pipeline:
    pre = ColumnTransformer([
        ("text", TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_df=0.9, strip_accents="unicode"), "full_text"),
        ("property", OneHotEncoder(handle_unknown="ignore"), ["eg_property_id"]),
    ])
    return Pipeline([
        ("features", pre),
        ("model", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_STATE)),
    ])


def regression_models() -> dict[str, object]:
    return {
        "mean_baseline": DummyRegressor(strategy="mean"),
        "text_tfidf": text_regressor(),
        "text_plus_property": text_property_regressor(),
    }


def classification_models() -> dict[str, object]:
    return {
        "majority_baseline": DummyClassifier(strategy="prior"),
        "text_tfidf": text_classifier(),
        "text_plus_property": text_property_classifier(),
    }


def regression_metrics(y_true: np.ndarray, pred: np.ndarray) -> dict[str, float]:
    pred = np.clip(pred, 1.0, 5.0)
    rounded = np.clip(np.rint(pred), 1, 5)
    return {
        "mae": float(mean_absolute_error(y_true, pred)),
        "mae_rounded": float(mean_absolute_error(y_true, rounded)),
    }


def classification_metrics(y_true: np.ndarray, prob: np.ndarray) -> dict[str, float]:
    prob = np.clip(prob, 1e-6, 1 - 1e-6)
    pred = (prob >= 0.5).astype(int)
    if len(np.unique(y_true)) < 2:
        roc = np.nan
        ap = np.nan
    else:
        roc = float(roc_auc_score(y_true, prob))
        ap = float(average_precision_score(y_true, prob))
    return {
        "roc_auc": roc,
        "avg_precision": ap,
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "positive_rate": float(np.mean(y_true)),
    }


def random_splits_binary(df: pd.DataFrame, y: pd.Series):
    splitter = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    return list(splitter.split(df, y))


def grouped_splits(df: pd.DataFrame):
    n_groups = df["eg_property_id"].nunique()
    n_splits = min(5, n_groups)
    splitter = GroupKFold(n_splits=n_splits)
    return list(splitter.split(df, groups=df["eg_property_id"]))


def temporal_split(df: pd.DataFrame):
    train_idx = np.where(df["acquisition_date"] < TEMPORAL_CUTOFF)[0]
    test_idx = np.where(df["acquisition_date"] >= TEMPORAL_CUTOFF)[0]
    if len(train_idx) == 0 or len(test_idx) == 0:
        return []
    return [(train_idx, test_idx)]


def evaluate_regression(df: pd.DataFrame, target: str, evaluation: str, splits, model_name: str, model) -> dict | None:
    if not splits:
        return None
    fold_metrics = []
    for train_idx, test_idx in splits:
        train = df.iloc[train_idx]
        test = df.iloc[test_idx]
        y_train = train[target].to_numpy()
        y_test = test[target].to_numpy()
        if len(np.unique(y_train)) < 2:
            continue
        X_train = train if model_name == "text_plus_property" else train["full_text"]
        X_test = test if model_name == "text_plus_property" else test["full_text"]
        model.fit(X_train, y_train)
        pred = model.predict(X_test)
        fold_metrics.append(regression_metrics(y_test, pred))
    if not fold_metrics:
        return None
    return {
        "task_type": "regression",
        "evaluation": evaluation,
        "model": model_name,
        "n_samples": int(len(df)),
        "n_folds": int(len(fold_metrics)),
        "mae": float(np.mean([m["mae"] for m in fold_metrics])),
        "mae_rounded": float(np.mean([m["mae_rounded"] for m in fold_metrics])),
    }


def evaluate_binary(df: pd.DataFrame, target: str, evaluation: str, splits, model_name: str, model) -> dict | None:
    if not splits:
        return None
    fold_metrics = []
    for train_idx, test_idx in splits:
        train = df.iloc[train_idx]
        test = df.iloc[test_idx]
        y_train = train[target].to_numpy()
        y_test = test[target].to_numpy()
        if len(np.unique(y_train)) < 2 or len(np.unique(y_test)) < 2:
            continue
        X_train = train if model_name == "text_plus_property" else train["full_text"]
        X_test = test if model_name == "text_plus_property" else test["full_text"]
        model.fit(X_train, y_train)
        prob = model.predict_proba(X_test)[:, 1]
        fold_metrics.append(classification_metrics(y_test, prob))
    if not fold_metrics:
        return None
    return {
        "task_type": "binary",
        "evaluation": evaluation,
        "model": model_name,
        "n_samples": int(len(df)),
        "n_folds": int(len(fold_metrics)),
        "roc_auc": float(np.nanmean([m["roc_auc"] for m in fold_metrics])),
        "avg_precision": float(np.nanmean([m["avg_precision"] for m in fold_metrics])),
        "f1": float(np.mean([m["f1"] for m in fold_metrics])),
        "positive_rate": float(np.mean([m["positive_rate"] for m in fold_metrics])),
    }


def chart_binary(metrics: pd.DataFrame):
    plot_df = metrics[(metrics["task_type"] == "binary") & (metrics["model"].isin(["text_tfidf", "text_plus_property"]))].copy()
    if plot_df.empty:
        return
    plot_df["label"] = plot_df["task"] + "\n" + plot_df["evaluation"]
    pivot = plot_df.pivot(index="label", columns="model", values="roc_auc").sort_index()
    fig, ax = plt.subplots(figsize=(12, 7))
    y = np.arange(len(pivot))
    ax.barh(y - 0.18, pivot["text_tfidf"], height=0.35, label="Text TF-IDF", color="#0ea5e9")
    ax.barh(y + 0.18, pivot["text_plus_property"], height=0.35, label="Text + property", color="#10b981")
    ax.set_yticks(y)
    ax.set_yticklabels(pivot.index)
    ax.set_xlim(0.45, 1.0)
    ax.set_xlabel("ROC AUC")
    ax.set_title("ML feasibility — low-rating detection by task and split")
    ax.legend()
    fig.tight_layout()
    fig.savefig(CHARTS / "19_ml_binary_feasibility.png", dpi=130)
    plt.close(fig)


def chart_regression(metrics: pd.DataFrame):
    plot_df = metrics[(metrics["task_type"] == "regression") & (metrics["model"].isin(["text_tfidf", "text_plus_property"]))].copy()
    if plot_df.empty:
        return
    plot_df["label"] = plot_df["task"] + "\n" + plot_df["evaluation"]
    pivot = plot_df.pivot(index="label", columns="model", values="mae").sort_index()
    fig, ax = plt.subplots(figsize=(12, 7))
    y = np.arange(len(pivot))
    ax.barh(y - 0.18, pivot["text_tfidf"], height=0.35, label="Text TF-IDF", color="#f59e0b")
    ax.barh(y + 0.18, pivot["text_plus_property"], height=0.35, label="Text + property", color="#8b5cf6")
    ax.set_yticks(y)
    ax.set_yticklabels(pivot.index)
    ax.set_xlabel("MAE (1-5 rating scale)")
    ax.set_title("ML feasibility — exact-star prediction by task and split")
    ax.legend()
    fig.tight_layout()
    fig.savefig(CHARTS / "20_ml_regression_feasibility.png", dpi=130)
    plt.close(fig)


def main():
    print(">> Loading reviews...")
    rev = load_reviews()
    tasks = build_tasks(rev)
    print(f"   built {len(tasks)} tasks with >= {MIN_TEXT_LEN} chars and enough labels")

    rows: list[dict] = []
    task_inventory: list[dict] = []
    for task in tasks:
        df = task["df"].copy().reset_index(drop=True)
        name = task["name"]
        task_inventory.append({
            "task": name,
            "n_rows": int(len(df)),
            "n_properties": int(df["eg_property_id"].nunique()),
            "date_min": str(df["acquisition_date"].min().date()),
            "date_max": str(df["acquisition_date"].max().date()),
            "negative_share_lte3": float(df["y_bin"].mean()),
        })

        eval_splits = {
            "random_cv": random_splits_binary(df, df["y_bin"]),
            "group_property_cv": grouped_splits(df),
            "temporal_holdout_2025+": temporal_split(df),
        }

        print(f">> Task: {name} ({len(df)} rows)")
        for evaluation, splits in eval_splits.items():
            for model_name, model in classification_models().items():
                result = evaluate_binary(df, "y_bin", evaluation, splits, model_name, model)
                if result:
                    result["task"] = name
                    rows.append(result)
            for model_name, model in regression_models().items():
                result = evaluate_regression(df, "y_reg", evaluation, splits, model_name, model)
                if result:
                    result["task"] = name
                    rows.append(result)

    metrics = pd.DataFrame(rows).sort_values(["task_type", "task", "evaluation", "model"])
    metrics.to_csv(ARTIFACTS / "ml_feasibility_metrics.csv", index=False)
    chart_binary(metrics)
    chart_regression(metrics)

    validated_conflicts = pd.read_csv(ARTIFACTS / "semantic_conflict_validated.csv")
    conflict_counts = validated_conflicts["facet"].value_counts().sort_values(ascending=False).to_dict()

    binary_text = metrics[(metrics["task_type"] == "binary") & (metrics["model"] == "text_tfidf")]
    grouped_binary = binary_text[binary_text["evaluation"] == "group_property_cv"].sort_values("roc_auc", ascending=False)
    temporal_binary = binary_text[binary_text["evaluation"] == "temporal_holdout_2025+"].sort_values("roc_auc", ascending=False)
    grouped_reg = metrics[(metrics["task_type"] == "regression") & (metrics["model"] == "text_tfidf") & (metrics["evaluation"] == "group_property_cv")].sort_values("mae")

    summary = {
        "text_length_threshold": MIN_TEXT_LEN,
        "temporal_cutoff": str(TEMPORAL_CUTOFF.date()),
        "task_inventory": task_inventory,
        "best_grouped_binary_auc": grouped_binary[["task", "roc_auc", "avg_precision", "f1"]].head(4).to_dict(orient="records"),
        "best_temporal_binary_auc": temporal_binary[["task", "roc_auc", "avg_precision", "f1"]].head(4).to_dict(orient="records"),
        "best_grouped_regression_mae": grouped_reg[["task", "mae", "mae_rounded"]].head(4).to_dict(orient="records"),
        "validated_conflict_counts": conflict_counts,
    }
    (ARTIFACTS / "ml_feasibility_summary.json").write_text(json.dumps(summary, indent=2))
    print(">> Wrote:")
    print(f"   {ARTIFACTS / 'ml_feasibility_metrics.csv'}")
    print(f"   {ARTIFACTS / 'ml_feasibility_summary.json'}")
    print(f"   {CHARTS / '19_ml_binary_feasibility.png'}")
    print(f"   {CHARTS / '20_ml_regression_feasibility.png'}")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
