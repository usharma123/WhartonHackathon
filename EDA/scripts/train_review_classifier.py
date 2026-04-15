"""Train and export the ReviewGap live review facet classifier.

This script keeps ML offline-only. It derives high-confidence labels from the
semantic facet score artifact, trains one logistic regression model per runtime
facet, and exports a TypeScript-runnable TF-IDF + linear classifier bundle.

Hyperparameters are loaded from experiment_config.py — edit that file, not this one.
See program.md for the full autoresearch ratchet loop instructions.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

import experiment_config as cfg  # noqa: E402 — loaded from same directory

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
ARTIFACTS = ROOT / "EDA" / "data_artifacts"
RUNTIME = ARTIFACTS / "runtime"
RUNTIME.mkdir(parents=True, exist_ok=True)

FACETS = [
    "check_in",
    "check_out",
    "amenities_breakfast",
    "amenities_parking",
    "know_before_you_go",
    "amenities_pool",
]
PRIMARY = {"check_in", "check_out", "amenities_breakfast", "amenities_parking"}
POSITIVE_MARGIN = cfg.POSITIVE_MARGIN
NEGATIVE_MARGIN = cfg.NEGATIVE_MARGIN
MIN_TEXT_LEN = cfg.MIN_TEXT_LEN
RANDOM_STATE = cfg.RANDOM_STATE

FIXTURE_TEXTS = [
    "Check-in took forty minutes, the front desk was overwhelmed, and our room was not ready.",
    "Breakfast was barely stocked, there was no coffee, and nothing was ready by eight.",
    "Parking was easy and free, but the pool was closed earlier than the listing said.",
]


def load_reviews() -> pd.DataFrame:
    reviews = pd.read_csv(DATA / "Reviews_PROC.csv")
    reviews["review_text"] = reviews["review_text"].fillna("")
    reviews["review_title"] = reviews["review_title"].fillna("")
    reviews["full_text"] = (
        reviews["review_title"] + ". " + reviews["review_text"]
    ).str.strip(". ").str.strip()
    reviews["text_len"] = reviews["full_text"].str.len()
    reviews = reviews[reviews["text_len"] >= 10].reset_index(drop=True)
    return reviews


def load_scores() -> pd.DataFrame:
    scores = pd.read_csv(ARTIFACTS / "semantic_facet_scores.csv")
    scores = scores.reset_index(drop=True)
    return scores


def load_thresholds() -> dict[str, float]:
    thresholds = pd.read_csv(ARTIFACTS / "semantic_thresholds.csv")
    return dict(zip(thresholds["facet"], thresholds["threshold"]))


def choose_split(frame: pd.DataFrame):
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
    groups = frame["eg_property_id"]
    return next(splitter.split(frame, groups=groups))


def select_threshold(y_true: np.ndarray, probabilities: np.ndarray) -> tuple[float, float, float, float]:
    best = (0.5, -1.0, 0.0, 0.0)
    for threshold in np.linspace(0.2, 0.8, 31):
        predicted = (probabilities >= threshold).astype(int)
        f1 = f1_score(y_true, predicted, zero_division=0)
        precision = precision_score(y_true, predicted, zero_division=0)
        recall = recall_score(y_true, predicted, zero_division=0)
        if f1 > best[1]:
            best = (float(round(threshold, 3)), float(f1), float(precision), float(recall))
    return best


def shipping_gate(facet: str, roc_auc: float, f1: float) -> bool:
    if facet in PRIMARY:
        return roc_auc >= cfg.PRIMARY_MIN_ROC_AUC and f1 >= cfg.PRIMARY_MIN_F1
    return roc_auc >= cfg.SECONDARY_MIN_ROC_AUC and f1 >= cfg.SECONDARY_MIN_F1


def top_terms(feature_names: list[str], coefficients: np.ndarray, take: int = 12) -> tuple[list[str], list[str]]:
    ranking = np.argsort(coefficients)
    negative = [feature_names[index] for index in ranking[:take]]
    positive = [feature_names[index] for index in ranking[-take:][::-1]]
    return positive, negative


def train_models():
    reviews = load_reviews()
    scores = load_scores()
    thresholds = load_thresholds()
    if len(reviews) != len(scores):
        raise RuntimeError("Review rows and semantic score rows are misaligned.")

    shared_vectorizer = TfidfVectorizer(
        lowercase=True,
        strip_accents="unicode",
        token_pattern=r"(?u)\b\w\w+\b",
        ngram_range=cfg.NGRAM_RANGE,
        min_df=cfg.MIN_DF,
        max_features=cfg.MAX_FEATURES,
        norm="l2",
        use_idf=True,
        smooth_idf=True,
    )
    shared_vectorizer.fit(reviews["full_text"])
    base_terms = shared_vectorizer.get_feature_names_out().tolist()
    base_vocab = {term: index for index, term in enumerate(base_terms)}

    models = []
    report = {"generatedAt": "2026-04-14", "shippingGatePassed": True, "facets": []}

    for facet in FACETS:
        threshold = thresholds[facet]
        positive = scores[facet] >= threshold + POSITIVE_MARGIN
        negative = scores[facet] <= max(0.0, threshold - NEGATIVE_MARGIN)
        mask = (positive | negative) & (reviews["text_len"] >= MIN_TEXT_LEN)
        frame = reviews.loc[mask, ["eg_property_id", "full_text"]].copy()
        frame["label"] = positive.loc[mask].astype(int).to_numpy()
        if frame["label"].nunique() < 2:
            raise RuntimeError(f"Not enough label variety to train {facet}.")

        train_idx, test_idx = choose_split(frame)
        train = frame.iloc[train_idx]
        test = frame.iloc[test_idx]
        model = LogisticRegression(
            random_state=cfg.RANDOM_STATE,
            max_iter=cfg.MAX_ITER,
            class_weight=cfg.CLASS_WEIGHT,
            C=cfg.C,
        )
        x_train = shared_vectorizer.transform(train["full_text"])
        x_test = shared_vectorizer.transform(test["full_text"])
        y_train = train["label"].to_numpy()
        y_test = test["label"].to_numpy()
        model.fit(x_train, y_train)
        probabilities = model.predict_proba(x_test)[:, 1]
        chosen_threshold, f1, precision, recall = select_threshold(y_test, probabilities)
        roc_auc = float(roc_auc_score(y_test, probabilities))
        passed = shipping_gate(facet, roc_auc, f1)
        report["shippingGatePassed"] = report["shippingGatePassed"] and passed

        x_all = shared_vectorizer.transform(frame["full_text"])
        model_final = LogisticRegression(
            random_state=cfg.RANDOM_STATE,
            max_iter=cfg.MAX_ITER,
            class_weight=cfg.CLASS_WEIGHT,
            C=cfg.C,
        )
        model_final.fit(x_all, frame["label"].to_numpy())

        positive_terms, negative_terms = top_terms(base_terms, model_final.coef_[0])
        models.append(
            {
                "facet": facet,
                "threshold": chosen_threshold,
                "trainingRows": int(len(train)),
                "validationRows": int(len(test)),
                "positiveRate": float(round(frame["label"].mean(), 4)),
                "rocAuc": float(round(roc_auc, 4)),
                "f1": float(round(f1, 4)),
                "precision": float(round(precision, 4)),
                "recall": float(round(recall, 4)),
                "coefficients": model_final.coef_[0].astype(float).tolist(),
                "intercept": float(model_final.intercept_[0]),
                "topPositiveTerms": positive_terms,
                "topNegativeTerms": negative_terms,
            }
        )
        report["facets"].append(
            {
                "facet": facet,
                "threshold": chosen_threshold,
                "trainingRows": int(len(train)),
                "validationRows": int(len(test)),
                "positiveRate": float(round(frame["label"].mean(), 4)),
                "rocAuc": float(round(roc_auc, 4)),
                "f1": float(round(f1, 4)),
                "precision": float(round(precision, 4)),
                "recall": float(round(recall, 4)),
                "shippingGatePassed": passed,
            }
        )

    artifact = {
        "artifactType": "facet_classifier",
        "version": "2026-04-14-v1",
        "generatedAt": "2026-04-14",
        "tokenizer": {
            "regex": r"\b\w\w+\b",
            "minTokenLength": 2,
            "ngramRange": [1, 2],
            "lowercase": True,
            "stripAccents": True,
            "l2Normalize": True,
        },
        "runtimeFacets": FACETS,
        "vocabulary": base_vocab,
        "terms": base_terms,
        "idf": shared_vectorizer.idf_.astype(float).tolist(),
        "models": [
            {
                "facet": model["facet"],
                "intercept": model["intercept"],
                "threshold": model["threshold"],
                "coefficients": model["coefficients"],
                "topPositiveTerms": model["topPositiveTerms"],
                "topNegativeTerms": model["topNegativeTerms"],
                "metrics": {
                    "trainingRows": model["trainingRows"],
                    "validationRows": model["validationRows"],
                    "positiveRate": model["positiveRate"],
                    "rocAuc": model["rocAuc"],
                    "f1": model["f1"],
                    "precision": model["precision"],
                    "recall": model["recall"],
                },
            }
            for model in models
        ],
    }

    fixture_matrix = shared_vectorizer.transform(FIXTURE_TEXTS)
    fixtures = []
    for row_index, text in enumerate(FIXTURE_TEXTS):
        probabilities = {}
        for model in models:
            score = float(
                fixture_matrix[row_index].dot(np.array(model["coefficients"])).item()
                + model["intercept"]
            )
            probabilities[model["facet"]] = float(round(1 / (1 + np.exp(-score)), 6))
        fixtures.append({"text": text, "probabilities": probabilities})

    (RUNTIME / "review_classifier_artifact.json").write_text(
        json.dumps(artifact, indent=2),
        encoding="utf8",
    )
    (RUNTIME / "review_classifier_report.json").write_text(
        json.dumps(report, indent=2),
        encoding="utf8",
    )
    (RUNTIME / "review_classifier_fixtures.json").write_text(
        json.dumps(fixtures, indent=2),
        encoding="utf8",
    )
    print(f"Wrote {RUNTIME / 'review_classifier_artifact.json'}")
    print(f"Wrote {RUNTIME / 'review_classifier_report.json'}")
    print(f"Wrote {RUNTIME / 'review_classifier_fixtures.json'}")


if __name__ == "__main__":
    train_models()
