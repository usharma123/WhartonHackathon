"""evaluate.py — IMMUTABLE evaluation harness. Do not modify.

Reads the training report produced by train_review_classifier.py,
computes the combined_score used for the autoresearch ratchet gate,
prints a summary, and appends one row to results.tsv.

Usage:
  python3 EDA/scripts/evaluate.py [--hypothesis "your hypothesis here"]

Or from the repo root:
  python3 EDA/scripts/evaluate.py --hypothesis "C=1.0 instead of 2.0"
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import experiment_config as cfg

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "EDA" / "data_artifacts" / "runtime"
RESULTS_TSV = RUNTIME / "results.tsv"

PRIMARY = {"check_in", "check_out", "amenities_breakfast", "amenities_parking"}
SECONDARY = {"know_before_you_go", "amenities_pool"}

TSV_FIELDS = [
    "timestamp",
    "hypothesis",
    "weighted_f1",
    "mean_roc_auc",
    "gate_rate",
    "combined_score",
    "kept",
    "C",
    "max_features",
    "positive_margin",
    "negative_margin",
    "min_text_len",
    "staleness_norm_days",
]


def load_report() -> dict:
    report_path = RUNTIME / "review_classifier_report.json"
    if not report_path.exists():
        sys.exit(
            f"ERROR: {report_path} not found.\n"
            "Run `python3 EDA/scripts/train_review_classifier.py` first."
        )
    return json.loads(report_path.read_text(encoding="utf8"))


def compute_metrics(report: dict) -> dict[str, float]:
    facets = report.get("facets", [])
    if not facets:
        sys.exit("ERROR: report.json contains no facet entries.")

    # Weighted F1 — primary facets get higher weight (they matter more for product)
    total_f1 = 0.0
    total_weight = 0.0
    roc_aucs: list[float] = []
    gates_passed = 0

    for entry in facets:
        facet = entry["facet"]
        f1 = entry.get("f1", 0.0)
        roc_auc = entry.get("rocAuc", 0.0)
        passed = entry.get("shippingGatePassed", False)

        weight = 2.0 if facet in PRIMARY else 1.0
        total_f1 += f1 * weight
        total_weight += weight
        roc_aucs.append(roc_auc)
        if passed:
            gates_passed += 1

    weighted_f1 = total_f1 / total_weight if total_weight > 0 else 0.0
    mean_roc_auc = sum(roc_aucs) / len(roc_aucs) if roc_aucs else 0.0
    gate_rate = gates_passed / len(facets) if facets else 0.0

    combined_score = 0.5 * weighted_f1 + 0.35 * mean_roc_auc + 0.15 * gate_rate

    return {
        "weighted_f1": weighted_f1,
        "mean_roc_auc": mean_roc_auc,
        "gate_rate": gate_rate,
        "combined_score": combined_score,
    }


def print_report(report: dict, metrics: dict[str, float]) -> None:
    print("\n" + "=" * 60)
    print("  ReviewGap AutoResearch Evaluation")
    print("=" * 60)
    print(f"  Config: C={cfg.C}, max_features={cfg.MAX_FEATURES}, "
          f"pos_margin={cfg.POSITIVE_MARGIN}, neg_margin={cfg.NEGATIVE_MARGIN}, "
          f"min_text_len={cfg.MIN_TEXT_LEN}")
    print("-" * 60)
    print(f"  {'Facet':<28} {'F1':>6}  {'ROC-AUC':>8}  {'Gate':>5}")
    print(f"  {'-'*28} {'-'*6}  {'-'*8}  {'-'*5}")
    for entry in report.get("facets", []):
        gate_str = "PASS" if entry.get("shippingGatePassed") else "FAIL"
        print(
            f"  {entry['facet']:<28} {entry.get('f1', 0):.4f}  "
            f"{entry.get('rocAuc', 0):.4f}    {gate_str}"
        )
    print("-" * 60)
    print(f"  weighted_f1    = {metrics['weighted_f1']:.4f}")
    print(f"  mean_roc_auc   = {metrics['mean_roc_auc']:.4f}")
    print(f"  gate_rate      = {metrics['gate_rate']:.4f}")
    print(f"  combined_score = {metrics['combined_score']:.4f}  ← ratchet metric")
    print("=" * 60)

    # Load previous best for comparison
    best = load_previous_best()
    if best is not None:
        delta = metrics["combined_score"] - best
        direction = "▲" if delta > 0 else ("▼" if delta < 0 else "=")
        print(f"  vs. previous best: {best:.4f}  {direction} {delta:+.4f}")
        if delta > 0:
            print("  → KEEP this commit.")
        else:
            print("  → REVERT: git checkout EDA/scripts/experiment_config.py")
    else:
        print("  (No previous results — this is the baseline.)")
    print("=" * 60 + "\n")


def load_previous_best() -> float | None:
    if not RESULTS_TSV.exists():
        return None
    rows = []
    with RESULTS_TSV.open(newline="", encoding="utf8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            try:
                rows.append(float(row["combined_score"]))
            except (KeyError, ValueError):
                pass
    return max(rows) if rows else None


def append_result(hypothesis: str, metrics: dict[str, float]) -> None:
    is_new = not RESULTS_TSV.exists()
    with RESULTS_TSV.open("a", newline="", encoding="utf8") as f:
        writer = csv.DictWriter(f, fieldnames=TSV_FIELDS, delimiter="\t")
        if is_new:
            writer.writeheader()
        writer.writerow(
            {
                "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "hypothesis": hypothesis,
                "weighted_f1": round(metrics["weighted_f1"], 4),
                "mean_roc_auc": round(metrics["mean_roc_auc"], 4),
                "gate_rate": round(metrics["gate_rate"], 4),
                "combined_score": round(metrics["combined_score"], 4),
                "kept": "?",  # agent fills this in after the ratchet decision
                "C": cfg.C,
                "max_features": cfg.MAX_FEATURES,
                "positive_margin": cfg.POSITIVE_MARGIN,
                "negative_margin": cfg.NEGATIVE_MARGIN,
                "min_text_len": cfg.MIN_TEXT_LEN,
                "staleness_norm_days": cfg.STALENESS_NORM_DAYS,
            }
        )
    print(f"Appended result to {RESULTS_TSV.relative_to(ROOT)}")
    print("Update the 'kept' column (yes/no) in results.tsv after the ratchet decision.\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate ReviewGap classifier training run.")
    parser.add_argument(
        "--hypothesis",
        default="baseline",
        help="Short description of what changed (used in results.tsv)",
    )
    args = parser.parse_args()

    report = load_report()
    metrics = compute_metrics(report)
    print_report(report, metrics)
    append_result(args.hypothesis, metrics)


if __name__ == "__main__":
    main()
