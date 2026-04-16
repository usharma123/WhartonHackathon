"""Adjudicate manual ReviewGap ranker labels and compute agreement metrics."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from itertools import combinations

import pandas as pd

from ranker_common import MANUAL

ANNOTATIONS_PATH = MANUAL / "annotations.csv"
TASKS_PATH = MANUAL / "annotation_tasks.json"
ADJUDICATED_JSON = MANUAL / "adjudicated_labels.json"
ADJUDICATED_CSV = MANUAL / "adjudicated_labels.csv"
REPORT_JSON = MANUAL / "agreement_report.json"


def parse_ranking(raw: object) -> list[str]:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return []
    text = str(raw).strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
        except json.JSONDecodeError:
            pass
    return [piece.strip() for piece in text.split("|") if piece.strip()]


def fleiss_kappa(votes: list[list[str]], categories: list[str]) -> float:
    if not votes:
        return 0.0
    category_index = {category: idx for idx, category in enumerate(categories)}
    matrix = []
    for task_votes in votes:
        row = [0] * len(categories)
        for vote in task_votes:
            row[category_index[vote]] += 1
        matrix.append(row)
    matrix_df = pd.DataFrame(matrix)
    n = matrix_df.sum(axis=1).iloc[0]
    p = matrix_df.sum(axis=0) / (len(matrix_df) * n)
    p_bar = ((matrix_df.pow(2).sum(axis=1) - n) / (n * (n - 1))).mean()
    p_e = (p.pow(2)).sum()
    if p_e >= 1:
        return 0.0
    return float((p_bar - p_e) / (1 - p_e))


def pairwise_rank_agreement(rankings: list[list[str]], candidates: list[str]) -> float:
    if len(rankings) < 2:
        return 1.0
    agreements: list[float] = []
    for left, right in combinations(rankings, 2):
        left_pos = {facet: idx for idx, facet in enumerate(left)}
        right_pos = {facet: idx for idx, facet in enumerate(right)}
        pair_matches = 0
        pair_total = 0
        for a, b in combinations(candidates, 2):
            if a not in left_pos or b not in left_pos or a not in right_pos or b not in right_pos:
                continue
            pair_total += 1
            pair_matches += int((left_pos[a] < left_pos[b]) == (right_pos[a] < right_pos[b]))
        agreements.append(pair_matches / pair_total if pair_total else 1.0)
    return float(sum(agreements) / len(agreements))


def main() -> None:
    if not ANNOTATIONS_PATH.exists():
        raise SystemExit(f"Missing {ANNOTATIONS_PATH}. Populate annotations first.")
    tasks = {task["taskId"]: task for task in json.loads(TASKS_PATH.read_text(encoding="utf8"))}
    annotations = pd.read_csv(ANNOTATIONS_PATH)
    annotations["ranking"] = annotations["ranking"].map(parse_ranking)

    adjudicated: list[dict[str, object]] = []
    vote_rows: list[list[str]] = []
    rank_agreements: list[float] = []
    categories = sorted(
        {
            facet
            for task in tasks.values()
            for facet in [candidate["facet"] for candidate in task["candidateFacets"]]
        }
    )

    for task_id, group in annotations.groupby("taskId"):
        task = tasks.get(task_id)
        if not task:
            continue
        top_votes = [str(value) for value in group["topFacet"].dropna().tolist()]
        if len(top_votes) < 2:
            continue
        vote_rows.append(top_votes)
        rankings = [ranking for ranking in group["ranking"].tolist() if ranking]
        vote_counter = Counter(top_votes)
        winner, winner_votes = vote_counter.most_common(1)[0]
        if winner_votes >= 2:
            final_ranking = next((ranking for ranking in rankings if ranking and ranking[0] == winner), [])
        else:
            candidates = [candidate["facet"] for candidate in task["candidateFacets"]]
            mean_rank = {}
            for facet in candidates:
                ranks = []
                for ranking in rankings:
                    if facet in ranking:
                        ranks.append(ranking.index(facet) + 1)
                mean_rank[facet] = sum(ranks) / len(ranks) if ranks else len(candidates) + 1
            final_ranking = sorted(candidates, key=lambda facet: (mean_rank[facet], facet))
            winner = final_ranking[0]
        rank_agreements.append(
            pairwise_rank_agreement(
                rankings,
                [candidate["facet"] for candidate in task["candidateFacets"]],
            )
        )
        adjudicated.append(
            {
                "taskId": task_id,
                "topFacet": winner,
                "ranking": final_ranking,
                "topFacetVoteCount": int(winner_votes),
                "annotatorCount": int(len(group)),
            }
        )

    ADJUDICATED_JSON.write_text(json.dumps(adjudicated, indent=2), encoding="utf8")
    pd.DataFrame(adjudicated).to_csv(ADJUDICATED_CSV, index=False)
    report = {
        "tasks": len(adjudicated),
        "fleissKappaTop1": fleiss_kappa(vote_rows, categories) if vote_rows else 0.0,
        "meanPairwiseRankAgreement": float(sum(rank_agreements) / len(rank_agreements))
        if rank_agreements
        else 0.0,
    }
    REPORT_JSON.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
