"""Export ReviewGap runtime artifacts for the TypeScript + Convex backend.

This is an offline-only step. It consumes validated EDA outputs and emits a
compact runtime bundle for Convex import.
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

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
    "pet",
    "children_extra_bed",
    "amenities_wifi",
    "amenities_gym",
]

BLOCKED = {"pet", "children_extra_bed", "amenities_wifi", "amenities_gym"}
IMPORTANCE = {
    "check_in": 0.95,
    "check_out": 0.84,
    "amenities_breakfast": 0.90,
    "amenities_parking": 0.92,
    "know_before_you_go": 0.70,
    "amenities_pool": 0.68,
    "pet": 0.30,
    "children_extra_bed": 0.28,
    "amenities_wifi": 0.26,
    "amenities_gym": 0.24,
}

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
    "pet": ["pet_policy"],
    "children_extra_bed": ["children_and_extra_bed_policy"],
    "amenities_wifi": ["popular_amenities_list", "property_amenity_internet"],
    "amenities_gym": ["popular_amenities_list", "property_amenity_things_to_do"],
}

DEMO_SCENARIOS = {
    "ff26cdda236b233f7c481f0e896814075ac6bed335e162e0ff01d5491343f838": {
        "scenario": "check_in_friction",
        "facet": "check_in",
        "flags": ["demo", "check_in_friction"],
        "snippet": "Validated check-in friction exists: earlier reviews describe long waits and inconsistent early check-in handling.",
    },
    "3216b1b7885bffdb336265a8de7322ba0cd477cfb3d4f99d19acf488f76a1941": {
        "scenario": "breakfast_mismatch",
        "facet": "amenities_breakfast",
        "flags": ["demo", "breakfast_mismatch"],
        "snippet": "Validated breakfast mismatch exists: listing support is present, but recent guest evidence reports missing or disappointing breakfast service.",
    },
    "7d027ef72c02eaa17af3c993fd5dba50d17b41a6280389a46c13c7e2c32a5b06": {
        "scenario": "parking_shortage_conflict",
        "facet": "amenities_parking",
        "flags": ["demo", "parking_shortage_conflict"],
        "snippet": "Validated parking conflict exists: multiple guests report parking pain despite listing support.",
    },
}


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf8") as handle:
        return list(csv.DictReader(handle))


def clean_text(value: str) -> str:
    if not value:
        return ""
    text = value.strip()
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


def float_value(row: dict[str, str], key: str, default: float = 0.0) -> float:
    raw = row.get(key, "")
    if raw in ("", None):
        return default
    return float(raw)


def int_value(row: dict[str, str], key: str, default: int = 0) -> int:
    raw = row.get(key, "")
    if raw in ("", None):
        return default
    return int(float(raw))


def staleness_score(days_since: int) -> float:
    if days_since >= 9999:
        return 1.0
    return round(min(days_since / 365.0, 1.0), 4)


def compute_reliability(
    facet: str,
    matched_review_rate: float,
    mean_cos_matched_reviews: float,
    validated_conflict_count: int,
    mention_rate: float,
    has_listing_text: bool,
) -> str:
    if facet in BLOCKED:
      return "blocked"
    if not has_listing_text:
      return "low"
    if validated_conflict_count > 0 or matched_review_rate >= 0.03:
        return "high"
    if (
        mean_cos_matched_reviews >= 0.32 and matched_review_rate >= 0.01
    ) or mention_rate >= 0.02:
        return "medium"
    return "low"


def build_listing_text(row: dict[str, str], facet: str) -> str:
    parts = []
    for field in FACET_LISTING_FIELDS[facet]:
        value = clean_text(row.get(field, ""))
        if value:
            parts.append(f"{field}: {value}")
    return " | ".join(parts)


def main() -> None:
    descriptions = load_csv(DATA / "Description_PROC.csv")
    freshness_rows = load_csv(ARTIFACTS / "property_facet_freshness.csv")
    drift_rows = load_csv(ARTIFACTS / "listing_review_drift_matched.csv")
    threshold_rows = load_csv(ARTIFACTS / "semantic_thresholds.csv")
    conflict_rows = load_csv(ARTIFACTS / "semantic_conflict_validated.csv")

    freshness_by_key = {
        (row["eg_property_id"], row["facet"]): row for row in freshness_rows
    }
    drift_by_key = {(row["eg_property_id"], row["facet"]): row for row in drift_rows}
    thresholds = {row["facet"]: float_value(row, "threshold", 0.4) for row in threshold_rows}

    conflicts_by_key: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in conflict_rows:
        conflicts_by_key[(row["eg_property_id"], row["facet"])].append(row)

    properties: list[dict[str, object]] = []
    metrics: list[dict[str, object]] = []
    evidence: list[dict[str, object]] = []

    for row in descriptions:
        property_id = row["eg_property_id"]
        facet_listing_texts = {
            facet: build_listing_text(row, facet)
            for facet in FACETS
            if build_listing_text(row, facet)
        }
        summary_parts = [
            ", ".join(
                part for part in [row.get("city", ""), row.get("province", ""), row.get("country", "")]
                if part
            ),
            clean_text(row.get("property_description", ""))[:320],
        ]
        summary = ". ".join(part for part in summary_parts if part)
        demo = DEMO_SCENARIOS.get(property_id)
        properties.append(
            {
                "propertyId": property_id,
                "city": row.get("city") or None,
                "province": row.get("province") or None,
                "country": row.get("country") or None,
                "starRating": float_value(row, "star_rating", 0.0) or None,
                "guestRating": float_value(row, "guestrating_avg_expedia", 0.0) or None,
                "propertySummary": summary,
                "popularAmenities": clean_text(row.get("popular_amenities_list", "")) or None,
                "facetListingTexts": facet_listing_texts,
                "demoScenario": demo["scenario"] if demo else None,
                "demoFlags": demo["flags"] if demo else [],
            }
        )

        for facet in FACETS:
            fresh = freshness_by_key.get((property_id, facet), {})
            drift = drift_by_key.get((property_id, facet), {})
            conflicts = sorted(
                conflicts_by_key.get((property_id, facet), []),
                key=lambda item: float_value(item, "validated_conflict_score"),
                reverse=True,
            )
            days_since = int_value(fresh, "days_since", 9999)
            matched_review_rate = float_value(drift, "matched_review_rate", 0.0)
            mean_cos_matched_reviews = float_value(drift, "mean_cos_matched_reviews", 0.0)
            mention_rate = float_value(fresh, "mention_rate", 0.0)
            listing_text = facet_listing_texts.get(facet, "")
            reliability = compute_reliability(
                facet,
                matched_review_rate,
                mean_cos_matched_reviews,
                len(conflicts),
                mention_rate,
                bool(listing_text),
            )
            metrics.append(
                {
                    "propertyId": property_id,
                    "facet": facet,
                    "importance": IMPORTANCE[facet],
                    "threshold": thresholds.get(facet, 0.4),
                    "reliabilityClass": reliability,
                    "daysSince": days_since,
                    "stalenessScore": staleness_score(days_since),
                    "mentionRate": mention_rate,
                    "matchedReviewRate": matched_review_rate,
                    "meanCosMatchedReviews": mean_cos_matched_reviews,
                    "validatedConflictCount": len(conflicts),
                    "validatedConflictScore": max(
                        (float_value(item, "validated_conflict_score", 0.0) for item in conflicts),
                        default=0.0,
                    ),
                    "listingTextPresent": bool(listing_text),
                }
            )

            if listing_text:
                evidence.append(
                    {
                        "propertyId": property_id,
                        "facet": facet,
                        "sourceType": "listing_summary",
                        "snippet": listing_text[:320],
                        "evidenceScore": 0.5,
                    }
                )

            for item in conflicts[:2]:
                evidence.append(
                    {
                        "propertyId": property_id,
                        "facet": facet,
                        "sourceType": "validated_conflict",
                        "snippet": clean_text(item.get("review_snippet", ""))[:320],
                        "acquisitionDate": item.get("acquisition_date") or None,
                        "evidenceScore": float_value(item, "validated_conflict_score", 0.0),
                    }
                )

            if demo and demo["facet"] == facet:
                evidence.append(
                    {
                        "propertyId": property_id,
                        "facet": facet,
                        "sourceType": "demo_scenario",
                        "snippet": demo["snippet"],
                        "evidenceScore": 0.95,
                    }
                )

    bundle = {
        "generatedAt": "2026-04-13",
        "sourceArtifacts": [
            "EDA/data_artifacts/property_facet_freshness.csv",
            "EDA/data_artifacts/listing_review_drift_matched.csv",
            "EDA/data_artifacts/semantic_conflict_validated.csv",
            "EDA/data_artifacts/semantic_thresholds.csv",
        ],
        "properties": properties,
        "propertyFacetMetrics": metrics,
        "propertyFacetEvidence": evidence,
    }

    bundle_path = RUNTIME / "reviewgap_runtime_bundle.json"
    metrics_csv_path = RUNTIME / "reviewgap_runtime_metrics.csv"

    bundle_path.write_text(json.dumps(bundle, indent=2), encoding="utf8")
    with metrics_csv_path.open("w", newline="", encoding="utf8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "propertyId",
                "facet",
                "importance",
                "threshold",
                "reliabilityClass",
                "daysSince",
                "stalenessScore",
                "mentionRate",
                "matchedReviewRate",
                "meanCosMatchedReviews",
                "validatedConflictCount",
                "validatedConflictScore",
                "listingTextPresent",
            ],
        )
        writer.writeheader()
        writer.writerows(metrics)

    print(f"Wrote {bundle_path}")
    print(f"Wrote {metrics_csv_path}")


if __name__ == "__main__":
    main()
