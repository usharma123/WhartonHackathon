"""Evaluate heuristic vs learned ReviewGap rankers.

Reads temporal snapshot predictions from `train_ranker.py` and, when present,
manual adjudications from the manual benchmark folder.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from ranker_common import MANUAL, RUNTIME, mrr, ndcg_at_k

SNAPSHOT_PATH = RUNTIME / "ranker_snapshots.csv"
REPORT_PATH = RUNTIME / "ranker_evaluation_report.json"
MANUAL_TASKS_PATH = MANUAL / "annotation_tasks.json"
MANUAL_LABELS_PATH = MANUAL / "adjudicated_labels.json"


def temporal_metrics(frame: pd.DataFrame, score_column: str) -> dict[str, float]:
    groups = frame[frame["split"] == "test"].groupby("group_id")
    ndcg1: list[float] = []
    ndcg3: list[float] = []
    mrr_values: list[float] = []
    conflict_hits = 0
    support_hits = 0
    group_count = 0

    for _, group in groups:
        if len(group) < 2:
            continue
        relevances = (group["utility"] - group["utility"].min()).tolist()
        scores = group[score_column].tolist()
        ndcg1.append(ndcg_at_k(relevances, scores, 1))
        ndcg3.append(ndcg_at_k(relevances, scores, min(3, len(group))))
        mrr_values.append(mrr(relevances, scores))
        top = group.sort_values(score_column, ascending=False).iloc[0]
        conflict_hits += int(float(top["future_conflict_max"]) > 0)
        support_hits += int(float(top["future_support_rate"]) > 0)
        group_count += 1

    if group_count == 0:
        raise RuntimeError("No temporal test groups available for evaluation.")

    return {
        "ndcg@1": float(np.mean(ndcg1)),
        "ndcg@3": float(np.mean(ndcg3)),
        "mrr": float(np.mean(mrr_values)),
        "top1_conflict_recall": float(conflict_hits / group_count),
        "top1_support_recall": float(support_hits / group_count),
        "groups": float(group_count),
    }


def manual_metrics() -> dict[str, dict[str, float]] | None:
    if not MANUAL_TASKS_PATH.exists() or not MANUAL_LABELS_PATH.exists():
        return None
    tasks = json.loads(MANUAL_TASKS_PATH.read_text(encoding="utf8"))
    adjudicated = {
        item["taskId"]: item for item in json.loads(MANUAL_LABELS_PATH.read_text(encoding="utf8"))
    }
    model_rows: dict[str, list[dict[str, float]]] = {
        "heuristic": [],
        "learned_linear": [],
        "learned_tree": [],
    }

    for task in tasks:
        label = adjudicated.get(task["taskId"])
        if not label:
            continue
        gold_ranking = label.get("ranking") or []
        if not gold_ranking:
            continue
        gold_top = label.get("topFacet") or gold_ranking[0]
        gold_gain = {facet: max(len(gold_ranking) - index, 0) for index, facet in enumerate(gold_ranking)}
        for model_name, key in [
            ("heuristic", "heuristicRanking"),
            ("learned_linear", "learnedLinearRanking"),
            ("learned_tree", "learnedTreeRanking"),
        ]:
            ranking = task.get(key) or []
            if not ranking:
                continue
            top_prediction = ranking[0]
            reciprocal_rank = 0.0
            for rank, facet in enumerate(ranking, start=1):
                if facet == gold_top:
                    reciprocal_rank = 1.0 / rank
                    break
            relevances = [gold_gain.get(facet, 0.0) for facet in ranking]
            scores = list(reversed(range(1, len(ranking) + 1)))
            model_rows[model_name].append(
                {
                    "top1": float(top_prediction == gold_top),
                    "mrr": reciprocal_rank,
                    "ndcg@3": ndcg_at_k(relevances, scores, min(3, len(ranking))),
                    "disagreement_win": float(
                        bool(task.get("heuristicVsLearnedDisagree"))
                        and model_name == "learned_linear"
                        and top_prediction == gold_top
                    ),
                }
            )

    summary: dict[str, dict[str, float]] = {}
    for model_name, rows in model_rows.items():
        if not rows:
            continue
        summary[model_name] = {
            "top1_accuracy": float(np.mean([row["top1"] for row in rows])),
            "mrr": float(np.mean([row["mrr"] for row in rows])),
            "ndcg@3": float(np.mean([row["ndcg@3"] for row in rows])),
            "win_rate_on_disagreement_cases": float(
                np.mean([row["disagreement_win"] for row in rows]) if rows else 0.0
            ),
            "tasks": float(len(rows)),
        }
    return summary or None


def main() -> None:
    if not SNAPSHOT_PATH.exists():
        raise SystemExit(
            f"Missing {SNAPSHOT_PATH}. Run `python3 EDA/scripts/train_ranker.py` first."
        )

    frame = pd.read_csv(SNAPSHOT_PATH)
    report = {
        "temporal": {
            "heuristic": temporal_metrics(frame, "heuristicScore"),
            "learned_linear": temporal_metrics(frame, "learned_linear_score"),
            "learned_tree": temporal_metrics(frame, "learned_tree_score"),
        },
        "manual": manual_metrics(),
    }

    temporal = report["temporal"]
    manual = report["manual"] or {}
    report["acceptance"] = {
        "linear_promote": (
            (
                manual.get("learned_linear", {}).get("top1_accuracy", 0.0)
                - manual.get("heuristic", {}).get("top1_accuracy", 0.0)
                >= 0.05
            )
            or (
                manual.get("learned_linear", {}).get("ndcg@3", 0.0)
                - manual.get("heuristic", {}).get("ndcg@3", 0.0)
                >= 0.05
            )
        )
        and (
            temporal["learned_linear"]["ndcg@3"] - temporal["heuristic"]["ndcg@3"] >= -0.01
        ),
        "tree_promote": (
            manual.get("learned_tree", {}).get("ndcg@3", 0.0)
            - manual.get("learned_linear", {}).get("ndcg@3", 0.0)
            >= 0.03
        )
        and (
            temporal["learned_tree"]["ndcg@3"] - temporal["learned_linear"]["ndcg@3"] >= 0.03
        ),
    }

    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
