"""evaluate.py — Evaluate the ReviewGap ML and rules layers.

Reads the training report produced by train_review_classifier.py and the runtime
metrics exported by export_runtime_artifacts.py, computes the ratchet metric,
prints a summary, and appends one row to results.tsv.

Usage:
  python3 EDA/scripts/evaluate.py [--hypothesis "your hypothesis here"]
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import experiment_config as cfg

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "EDA" / "data_artifacts"
RUNTIME = ARTIFACTS / "runtime"
REPORT_PATH = RUNTIME / "review_classifier_report.json"
RUNTIME_METRICS_CSV = RUNTIME / "reviewgap_runtime_metrics.csv"
RESULTS_TSV = RUNTIME / "results.tsv"
VALIDATED_CONFLICTS_CSV = ARTIFACTS / "semantic_conflict_validated.csv"

PRIMARY = {"check_in", "check_out", "amenities_breakfast", "amenities_parking"}
SCORED_RULE_FACETS = {
    "check_in",
    "check_out",
    "amenities_breakfast",
    "amenities_parking",
    "know_before_you_go",
    "amenities_pool",
}
ELIGIBLE_RELIABILITY = {"high", "medium"}

TSV_FIELDS = [
    "timestamp",
    "hypothesis",
    "weighted_f1",
    "mean_roc_auc",
    "gate_rate",
    "ml_score",
    "rules_positive_recall",
    "rules_top1_accuracy",
    "rules_mrr",
    "rules_score",
    "combined_score",
    "kept",
    "C",
    "max_features",
    "positive_margin",
    "negative_margin",
    "min_text_len",
    "staleness_norm_days",
]


def load_classifier_report() -> dict:
    if not REPORT_PATH.exists():
        sys.exit(
            f"ERROR: {REPORT_PATH} not found.\n"
            "Run `python3 EDA/scripts/train_review_classifier.py` first."
        )
    return json.loads(REPORT_PATH.read_text(encoding="utf8"))


def load_runtime_metrics() -> list[dict[str, str]]:
    if not RUNTIME_METRICS_CSV.exists():
        sys.exit(
            f"ERROR: {RUNTIME_METRICS_CSV} not found.\n"
            "Run `python3 EDA/scripts/export_runtime_artifacts.py` first."
        )
    with RUNTIME_METRICS_CSV.open(newline="", encoding="utf8") as handle:
        return list(csv.DictReader(handle))


def load_validated_conflicts() -> dict[str, set[str]]:
    positives: dict[str, set[str]] = defaultdict(set)
    with VALIDATED_CONFLICTS_CSV.open(newline="", encoding="utf8") as handle:
        for row in csv.DictReader(handle):
            facet = row.get("facet", "")
            if facet not in SCORED_RULE_FACETS:
                continue
            score = safe_float(row.get("validated_conflict_score"))
            if not math.isfinite(score) or score <= 0:
                continue
            positives[row["eg_property_id"]].add(facet)
    if not positives:
        sys.exit("ERROR: No validated conflicts found for rules-layer evaluation.")
    return positives


def safe_float(value: str | None, default: float = float("nan")) -> float:
    if value in ("", None):
        return default
    try:
        return float(value)
    except ValueError:
        return default


def safe_bool(value: str | None) -> bool:
    return value in {"1", "true", "True", "yes", "YES"}


def clamp(value: float, min_value: float = 0.0, max_value: float = 1.0) -> float:
    return max(min_value, min(max_value, value))


def is_finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def compute_ml_metrics(report: dict) -> dict[str, float]:
    facets = report.get("facets", [])
    if not facets:
        sys.exit("ERROR: review_classifier_report.json contains no facet entries.")

    total_f1 = 0.0
    total_weight = 0.0
    roc_aucs: list[float] = []
    gates_passed = 0

    for entry in facets:
        facet = entry["facet"]
        weight = cfg.IMPORTANCE.get(facet, 1.0)
        f1 = safe_float(str(entry.get("f1", "")), 0.0)
        roc_auc = safe_float(str(entry.get("rocAuc", "")), float("nan"))
        passed = bool(entry.get("shippingGatePassed", False))

        total_f1 += f1 * weight
        total_weight += weight
        if math.isfinite(roc_auc):
            roc_aucs.append(roc_auc)
        if passed:
            gates_passed += 1

    weighted_f1 = total_f1 / total_weight if total_weight > 0 else 0.0
    mean_roc_auc = sum(roc_aucs) / len(roc_aucs) if roc_aucs else 0.0
    gate_rate = gates_passed / len(facets)
    ml_score = 0.5 * weighted_f1 + 0.35 * mean_roc_auc + 0.15 * gate_rate

    return {
        "weighted_f1": weighted_f1,
        "mean_roc_auc": mean_roc_auc,
        "gate_rate": gate_rate,
        "ml_score": ml_score,
    }


def matched_support(metric: dict[str, str]) -> float:
    matched_review_rate = safe_float(metric.get("matchedReviewRate"), 0.0)
    mean_cos = safe_float(metric.get("meanCosMatchedReviews"), 0.0)
    if matched_review_rate <= 0 or mean_cos <= 0:
        return 0.0
    return clamp(mean_cos)


def normalize_conflict(metric: dict[str, str]) -> float:
    score = safe_float(metric.get("validatedConflictScore"), 0.0)
    return clamp(score / 0.08)


def metric_total(metric: dict[str, str]) -> float:
    importance = safe_float(metric.get("importance"), 0.0)
    staleness = safe_float(metric.get("stalenessScore"), 0.0)
    mention_rate = safe_float(metric.get("mentionRate"), 0.0)
    support_gap = 1 - matched_support(metric)
    return (
        importance * 0.25
        + staleness * 0.25
        + normalize_conflict(metric) * 0.20
        + (1 - mention_rate) * 0.15
        + support_gap * 0.15
    )


def is_rule_candidate(metric: dict[str, str]) -> bool:
    return (
        metric.get("facet") in SCORED_RULE_FACETS
        and safe_bool(metric.get("listingTextPresent"))
        and metric.get("reliabilityClass") in ELIGIBLE_RELIABILITY
    )


def compute_rules_metrics(runtime_metrics: list[dict[str, str]]) -> dict[str, float]:
    positives = load_validated_conflicts()
    metrics_by_key = {
        (row["propertyId"], row["facet"]): row
        for row in runtime_metrics
        if row.get("facet") in SCORED_RULE_FACETS
    }
    metrics_by_property: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in runtime_metrics:
        if row.get("facet") in SCORED_RULE_FACETS:
            metrics_by_property[row["propertyId"]].append(row)

    total_positive_facets = 0
    eligible_positive_facets = 0
    property_count = len(positives)
    top1_hits = 0
    reciprocal_rank_sum = 0.0

    for property_id, positive_facets in positives.items():
        total_positive_facets += len(positive_facets)
        for facet in positive_facets:
            metric = metrics_by_key.get((property_id, facet))
            if metric and is_rule_candidate(metric):
                eligible_positive_facets += 1

        ranked = sorted(
            (
                metric
                for metric in metrics_by_property.get(property_id, [])
                if is_rule_candidate(metric)
            ),
            key=metric_total,
            reverse=True,
        )
        if not ranked:
            continue
        positive_ranks = [
            rank
            for rank, metric in enumerate(ranked, start=1)
            if metric["facet"] in positive_facets
        ]
        if not positive_ranks:
            continue
        top1_hits += int(positive_ranks[0] == 1)
        reciprocal_rank_sum += 1 / positive_ranks[0]

    positive_recall = (
        eligible_positive_facets / total_positive_facets if total_positive_facets > 0 else 0.0
    )
    top1_accuracy = top1_hits / property_count if property_count > 0 else 0.0
    mrr = reciprocal_rank_sum / property_count if property_count > 0 else 0.0
    rules_score = 0.4 * positive_recall + 0.3 * top1_accuracy + 0.3 * mrr

    return {
        "rules_positive_recall": positive_recall,
        "rules_top1_accuracy": top1_accuracy,
        "rules_mrr": mrr,
        "rules_score": rules_score,
        "rules_eval_properties": float(property_count),
        "rules_eval_positive_facets": float(total_positive_facets),
    }


def compute_combined_score(ml_metrics: dict[str, float], rules_metrics: dict[str, float]) -> float:
    return 0.85 * ml_metrics["ml_score"] + 0.15 * rules_metrics["rules_score"]


def load_result_rows() -> list[dict[str, str]]:
    if not RESULTS_TSV.exists():
        return []
    with RESULTS_TSV.open(newline="", encoding="utf8") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def normalize_result_row(row: dict[str, str]) -> dict[str, str]:
    normalized = {field: row.get(field, "") for field in TSV_FIELDS}
    if not normalized["weighted_f1"]:
        normalized["weighted_f1"] = row.get("weighted_f1", "")
    if not normalized["mean_roc_auc"]:
        normalized["mean_roc_auc"] = row.get("mean_roc_auc", "")
    if not normalized["gate_rate"]:
        normalized["gate_rate"] = row.get("gate_rate", "")
    if not normalized["combined_score"]:
        normalized["combined_score"] = row.get("combined_score", "")
    if not normalized["kept"]:
        normalized["kept"] = row.get("kept", "")
    return normalized


def load_previous_best(rows: list[dict[str, str]]) -> float | None:
    best: float | None = None
    for row in rows:
        if row.get("kept") != "yes":
            continue
        score = safe_float(row.get("combined_score"))
        if not math.isfinite(score):
            continue
        if best is None or score > best:
            best = score
    return best


def write_result_rows(rows: list[dict[str, str]]) -> None:
    with RESULTS_TSV.open("w", newline="", encoding="utf8") as handle:
        writer = csv.DictWriter(handle, fieldnames=TSV_FIELDS, delimiter="\t")
        writer.writeheader()
        for row in rows:
            writer.writerow(normalize_result_row(row))


def append_result(
    hypothesis: str,
    ml_metrics: dict[str, float],
    rules_metrics: dict[str, float],
    combined_score: float,
) -> tuple[str, float | None]:
    rows = load_result_rows()
    previous_best = load_previous_best(rows)
    kept = "yes" if previous_best is None or combined_score > previous_best else "no"
    rows.append(
        {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "hypothesis": hypothesis,
            "weighted_f1": f"{ml_metrics['weighted_f1']:.4f}",
            "mean_roc_auc": f"{ml_metrics['mean_roc_auc']:.4f}",
            "gate_rate": f"{ml_metrics['gate_rate']:.4f}",
            "ml_score": f"{ml_metrics['ml_score']:.4f}",
            "rules_positive_recall": f"{rules_metrics['rules_positive_recall']:.4f}",
            "rules_top1_accuracy": f"{rules_metrics['rules_top1_accuracy']:.4f}",
            "rules_mrr": f"{rules_metrics['rules_mrr']:.4f}",
            "rules_score": f"{rules_metrics['rules_score']:.4f}",
            "combined_score": f"{combined_score:.4f}",
            "kept": kept,
            "C": str(cfg.C),
            "max_features": str(cfg.MAX_FEATURES),
            "positive_margin": str(cfg.POSITIVE_MARGIN),
            "negative_margin": str(cfg.NEGATIVE_MARGIN),
            "min_text_len": str(cfg.MIN_TEXT_LEN),
            "staleness_norm_days": str(cfg.STALENESS_NORM_DAYS),
        }
    )
    write_result_rows(rows)
    return kept, previous_best


def print_report(
    report: dict,
    ml_metrics: dict[str, float],
    rules_metrics: dict[str, float],
    combined_score: float,
    previous_best: float | None,
    kept: str,
) -> None:
    print("\n" + "=" * 60)
    print("  ReviewGap AutoResearch Evaluation")
    print("=" * 60)
    print(
        "  Config: "
        f"C={cfg.C}, max_features={cfg.MAX_FEATURES}, "
        f"pos_margin={cfg.POSITIVE_MARGIN}, neg_margin={cfg.NEGATIVE_MARGIN}, "
        f"min_text_len={cfg.MIN_TEXT_LEN}, cv_folds={cfg.CV_FOLDS}"
    )
    print(f"  ML eval: {report.get('evaluation', {}).get('type', 'unknown')}")
    print("-" * 60)
    print(f"  {'Facet':<28} {'F1':>6}  {'ROC-AUC':>8}  {'Gate':>5}")
    print(f"  {'-'*28} {'-'*6}  {'-'*8}  {'-'*5}")
    for entry in report.get("facets", []):
        gate_str = "PASS" if entry.get("shippingGatePassed") else "FAIL"
        print(
            f"  {entry['facet']:<28} {safe_float(str(entry.get('f1', 0)), 0.0):.4f}  "
            f"{safe_float(str(entry.get('rocAuc', 0)), 0.0):.4f}    {gate_str}"
        )
    print("-" * 60)
    print(f"  weighted_f1    = {ml_metrics['weighted_f1']:.4f}")
    print(f"  mean_roc_auc   = {ml_metrics['mean_roc_auc']:.4f}")
    print(f"  gate_rate      = {ml_metrics['gate_rate']:.4f}")
    print(f"  ml_score       = {ml_metrics['ml_score']:.4f}")
    print("-" * 60)
    print(f"  rules_recall   = {rules_metrics['rules_positive_recall']:.4f}")
    print(f"  rules_top1     = {rules_metrics['rules_top1_accuracy']:.4f}")
    print(f"  rules_mrr      = {rules_metrics['rules_mrr']:.4f}")
    print(f"  rules_score    = {rules_metrics['rules_score']:.4f}")
    print("-" * 60)
    print(f"  combined_score = {combined_score:.4f}  ← ratchet metric")
    print("=" * 60)
    if previous_best is not None:
        delta = combined_score - previous_best
        direction = "▲" if delta > 0 else ("▼" if delta < 0 else "=")
        print(f"  vs. previous kept best: {previous_best:.4f}  {direction} {delta:+.4f}")
    else:
        print("  (No previous kept result — this run establishes the ratchet baseline.)")
    print(f"  decision: {'KEEP' if kept == 'yes' else 'REVERT'}")
    print("=" * 60 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate ReviewGap classifier and rules artifacts.")
    parser.add_argument(
        "--hypothesis",
        default="baseline",
        help="Short description of what changed (used in results.tsv)",
    )
    args = parser.parse_args()

    report = load_classifier_report()
    runtime_metrics = load_runtime_metrics()
    ml_metrics = compute_ml_metrics(report)
    rules_metrics = compute_rules_metrics(runtime_metrics)
    combined_score = compute_combined_score(ml_metrics, rules_metrics)
    kept, previous_best = append_result(args.hypothesis, ml_metrics, rules_metrics, combined_score)
    print_report(report, ml_metrics, rules_metrics, combined_score, previous_best, kept)
    print(f"Appended result to {RESULTS_TSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
