"""Generate manual annotation tasks for the ReviewGap next-facet ranker."""
from __future__ import annotations

import json
from random import Random

import pandas as pd

from ranker_common import MANUAL, assign_temporal_split, build_temporal_snapshots

TARGET_TASKS = 180
CALIBRATION_TASKS = 60
DISAGREEMENT_TARGET = 20
RNG = Random(42)


def bucket(value: float) -> str:
    if value >= 0.67:
        return "high"
    if value >= 0.34:
        return "medium"
    return "low"


def choose_groups(frame: pd.DataFrame) -> list[str]:
    meta = (
        frame.groupby("group_id")
        .agg(
            property_id=("property_id", "first"),
            draft_sentiment=("draft_sentiment", "first"),
            heuristic_top=("heuristicScore", "idxmax"),
            learned_top=("learned_linear_score", "idxmax")
            if "learned_linear_score" in frame.columns
            else ("heuristicScore", "idxmax"),
        )
        .reset_index()
    )
    if "learned_linear_score" in frame.columns:
        meta["heuristicFacet"] = meta["heuristic_top"].map(frame["facet"])
        meta["learnedFacet"] = meta["learned_top"].map(frame["facet"])
        meta["disagrees"] = meta["heuristicFacet"] != meta["learnedFacet"]
    else:
        meta["disagrees"] = False

    disagreements = meta[meta["disagrees"]]["group_id"].tolist()
    selected: list[str] = disagreements[:DISAGREEMENT_TARGET]

    remaining = [group_id for group_id in meta["group_id"].tolist() if group_id not in selected]
    RNG.shuffle(remaining)
    for group_id in remaining:
        if len(selected) >= TARGET_TASKS:
            break
        selected.append(group_id)
    return selected[:TARGET_TASKS]


def build_tasks(frame: pd.DataFrame) -> list[dict[str, object]]:
    selected_groups = choose_groups(frame)
    tasks: list[dict[str, object]] = []
    for index, group_id in enumerate(selected_groups):
        group = frame[frame["group_id"] == group_id].sort_values("facet").reset_index(drop=True)
        first = group.iloc[0]
        heuristic_ranking = group.sort_values("heuristicScore", ascending=False)["facet"].tolist()
        learned_linear_ranking = (
            group.sort_values("learned_linear_score", ascending=False)["facet"].tolist()
            if "learned_linear_score" in group.columns
            else heuristic_ranking
        )
        learned_tree_ranking = (
            group.sort_values("learned_tree_score", ascending=False)["facet"].tolist()
            if "learned_tree_score" in group.columns
            else learned_linear_ranking
        )
        tasks.append(
            {
                "taskId": f"ranker_task_{index + 1:03d}",
                "split": "calibration" if index < CALIBRATION_TASKS else "evaluation",
                "propertyId": first["property_id"],
                "cutoffDate": first["cutoff_date"],
                "draftReview": first["draft_review"],
                "draftSentiment": first["draft_sentiment"],
                "draftSourceReviewDate": first["recent_review_date"],
                "heuristicRanking": heuristic_ranking,
                "learnedLinearRanking": learned_linear_ranking,
                "learnedTreeRanking": learned_tree_ranking,
                "heuristicVsLearnedDisagree": heuristic_ranking[:1] != learned_linear_ranking[:1],
                "candidateFacets": [
                    {
                        "facet": row["facet"],
                        "listingText": row["listingText"],
                        "importance": float(row["importance"]),
                        "stalenessScore": float(row["stalenessScore"]),
                        "stalenessBucket": bucket(float(row["stalenessScore"])),
                        "validatedConflictScore": float(row["validatedConflictScore"]),
                        "conflictBucket": bucket(min(float(row["validatedConflictScore"]) / 0.08, 1.0)),
                        "mentionRate": float(row["mentionRate"]),
                        "matchedReviewRate": float(row["matchedReviewRate"]),
                        "preCutoffReviewCount": int(row["preCutoffReviewCount"]),
                    }
                    for _, row in group.iterrows()
                ],
            }
        )
    return tasks


def write_rubric() -> None:
    rubric = """# ReviewGap Manual Ranker Rubric

Pick the facet that would most improve traveler-useful information if asked next.

Prioritize:
- High traveler relevance.
- Unresolved, stale, or conflicting property information.
- Facets the traveler could plausibly answer from their stay.
- Non-redundancy with what is already in the draft review.

Do not choose a facet that the draft already clearly covers.

For each task, provide:
- `topFacet`
- `ranking` as an ordered list of candidate facets from best to worst
- optional confidence from 1 to 3
"""
    (MANUAL / "annotation_rubric.md").write_text(rubric, encoding="utf8")


def main() -> None:
    bundle = build_temporal_snapshots()
    frame = assign_temporal_split(bundle.snapshots)
    snapshot_csv = MANUAL / "annotation_task_source.csv"
    frame.to_csv(snapshot_csv, index=False)

    runtime_snapshot_path = MANUAL.parent / "runtime" / "ranker_snapshots.csv"
    if runtime_snapshot_path.exists():
        trained = pd.read_csv(runtime_snapshot_path)
        frame = trained

    tasks = build_tasks(frame)
    (MANUAL / "annotation_tasks.json").write_text(json.dumps(tasks, indent=2), encoding="utf8")
    pd.DataFrame(
        [
            {
                "taskId": task["taskId"],
                "split": task["split"],
                "propertyId": task["propertyId"],
                "cutoffDate": task["cutoffDate"],
                "draftSentiment": task["draftSentiment"],
                "heuristicVsLearnedDisagree": task["heuristicVsLearnedDisagree"],
                "draftReview": task["draftReview"],
                "candidateFacets": "|".join(
                    facet["facet"] for facet in task["candidateFacets"]  # type: ignore[index]
                ),
            }
            for task in tasks
        ]
    ).to_csv(MANUAL / "annotation_tasks.csv", index=False)
    pd.DataFrame(
        [
            {
                "taskId": task["taskId"],
                "annotatorId": "",
                "topFacet": "",
                "ranking": "",
                "confidence": "",
            }
            for task in tasks
        ]
    ).to_csv(MANUAL / "annotations_template.csv", index=False)
    write_rubric()
    print(f"Wrote {MANUAL / 'annotation_tasks.json'}")
    print(f"Wrote {MANUAL / 'annotation_tasks.csv'}")
    print(f"Wrote {MANUAL / 'annotations_template.csv'}")
    print(f"Wrote {MANUAL / 'annotation_rubric.md'}")


if __name__ == "__main__":
    main()
