"""Train the ReviewGap learned ranker with temporal snapshots.

Builds grouped `(property, cutoff, facet)` examples, fits a linear pairwise
ranker for runtime use, and fits an experimental tree regressor for offline
comparison only. Outputs runtime artifacts plus temporal snapshot CSVs.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import LogisticRegression

from ranker_common import (
    RANDOM_STATE,
    RUNTIME,
    add_utility_columns,
    assign_temporal_split,
    build_temporal_snapshots,
    prepare_feature_frame,
)


def build_pairwise_dataset(frame: pd.DataFrame, feature_keys: list[str]) -> tuple[np.ndarray, np.ndarray]:
    rows: list[np.ndarray] = []
    labels: list[int] = []
    for _, group in frame.groupby("group_id"):
        values = group[feature_keys].to_numpy(dtype=float)
        utility = group["utility"].to_numpy(dtype=float)
        for left in range(len(group)):
            for right in range(left + 1, len(group)):
                if utility[left] == utility[right]:
                    continue
                diff = values[left] - values[right]
                label = int(utility[left] > utility[right])
                rows.append(diff)
                labels.append(label)
                rows.append(-diff)
                labels.append(1 - label)
    if not rows:
        raise RuntimeError("No valid pairwise training examples were generated.")
    return np.vstack(rows), np.asarray(labels, dtype=int)


def main() -> None:
    bundle = build_temporal_snapshots()
    frame = assign_temporal_split(bundle.snapshots)
    frame, utility_stats = add_utility_columns(frame)
    frame, feature_keys = prepare_feature_frame(frame)

    train = frame[frame["split"] == "train"].copy()
    test = frame[frame["split"] == "test"].copy()
    if train.empty or test.empty:
        raise RuntimeError("Temporal split produced an empty train or test partition.")

    feature_means = train[feature_keys].mean()
    feature_stds = train[feature_keys].std(ddof=0).replace(0, 1.0)
    standardized = (frame[feature_keys].astype(float) - feature_means) / feature_stds
    for key in feature_keys:
        frame[key] = standardized[key]
    train = frame[frame["split"] == "train"].copy()
    test = frame[frame["split"] == "test"].copy()

    pair_x, pair_y = build_pairwise_dataset(train, feature_keys)
    linear = LogisticRegression(
        max_iter=3000,
        random_state=RANDOM_STATE,
        class_weight="balanced",
    )
    linear.fit(pair_x, pair_y)

    frame["learned_linear_score"] = frame[feature_keys].to_numpy(dtype=float) @ linear.coef_[0] + float(
        linear.intercept_[0]
    )

    tree = GradientBoostingRegressor(random_state=RANDOM_STATE)
    tree.fit(train[feature_keys], train["utility"])
    frame["learned_tree_score"] = tree.predict(frame[feature_keys])

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    linear_artifact = {
        "artifactType": "learned_ranker",
        "version": f"{generated_at}-linear",
        "generatedAt": generated_at,
        "modelKind": "linear",
        "featureKeys": feature_keys,
        "featureStats": [
            {"mean": float(feature_means[key]), "std": float(feature_stds[key])}
            for key in feature_keys
        ],
        "coefficients": [float(value) for value in linear.coef_[0]],
        "intercept": float(linear.intercept_[0]),
        "notes": [
            "Temporal monthly snapshots with 180-day lookahead.",
            "Base score only; runtime session adjustments remain deterministic.",
        ],
    }
    tree_experiment = {
        "artifactType": "learned_ranker",
        "version": f"{generated_at}-tree",
        "generatedAt": generated_at,
        "modelKind": "tree",
        "featureKeys": feature_keys,
        "notes": [
            "Experimental sklearn GradientBoostingRegressor reranker.",
            "Tree model is offline-only in v1 and not loaded into runtime scoring.",
        ],
        "treePayloadJson": json.dumps(
            {
                "model": "GradientBoostingRegressor",
                "params": tree.get_params(),
                "featureImportances": {
                    key: float(value)
                    for key, value in zip(feature_keys, tree.feature_importances_)
                },
            }
        ),
    }

    (RUNTIME / "ranker_snapshots.csv").write_text(frame.to_csv(index=False), encoding="utf8")
    (RUNTIME / "learned_ranker_artifact.json").write_text(
        json.dumps(linear_artifact, indent=2),
        encoding="utf8",
    )
    (RUNTIME / "learned_ranker_tree_experiment.json").write_text(
        json.dumps(tree_experiment, indent=2),
        encoding="utf8",
    )
    (RUNTIME / "ranker_training_report.json").write_text(
        json.dumps(
            {
                "generatedAt": generated_at,
                "snapshotRows": int(len(frame)),
                "trainRows": int(len(train)),
                "testRows": int(len(test)),
                "pairwiseTrainingRows": int(len(pair_x)),
                "featureKeys": feature_keys,
                "utilityStats": utility_stats,
                "linearVersion": linear_artifact["version"],
                "treeVersion": tree_experiment["version"],
            },
            indent=2,
        ),
        encoding="utf8",
    )

    print(f"Wrote {RUNTIME / 'learned_ranker_artifact.json'}")
    print(f"Wrote {RUNTIME / 'learned_ranker_tree_experiment.json'}")
    print(f"Wrote {RUNTIME / 'ranker_snapshots.csv'}")


if __name__ == "__main__":
    main()
