#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib import error, request

from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "data" / "expedia_subset.json"
DEFAULT_OUTPUT = ROOT / "data" / "expedia_subset_artifact.json"

RUNTIME_FACETS = [
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape a curated Expedia subset with Firecrawl and OpenAI.")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--max", type=int, default=50)
    parser.add_argument("--model", default="gpt-4o-mini")
    args = parser.parse_args()

    load_env(ROOT)
    firecrawl_api_key = os.environ.get("FIRECRAWL_API_KEY")
    openai_api_key = os.environ.get("OPENAI_API_KEY")
    if not firecrawl_api_key:
        raise SystemExit("Missing FIRECRAWL_API_KEY.")
    if not openai_api_key:
        raise SystemExit("Missing OPENAI_API_KEY.")

    manifest_path = Path(args.manifest)
    output_path = Path(args.output)
    entries = json.loads(manifest_path.read_text())
    if not isinstance(entries, list):
        raise SystemExit("Manifest must be a JSON array.")

    selected = entries[: args.limit]
    if len(selected) > args.max:
        raise SystemExit(f"Refusing to scrape more than {args.max} properties in one run.")

    client = OpenAI(api_key=openai_api_key)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    artifact_properties: list[dict[str, Any]] = []
    report: list[dict[str, Any]] = []
    generated_at = iso_now()

    for index, entry in enumerate(selected, start=1):
        url = str(entry.get("expediaUrl", "")).strip()
        if not url:
            report.append({"index": index, "status": "error", "error": "Missing expediaUrl"})
            continue

        property_id = str(entry.get("propertyId") or hashed_property_id(url))
        print(f"[{index}/{len(selected)}] {property_id} -> {url}")
        try:
            scrape = firecrawl_scrape(url, firecrawl_api_key)
            snapshot = extract_snapshot_with_openai(client, args.model, scrape, url)
            property_payload = {
                "propertyId": property_id,
                "sourceVendor": "expedia",
                "sourceUrl": snapshot["sourceUrl"],
                "propertySummary": snapshot["propertySummary"],
                "popularAmenities": snapshot.get("popularAmenities"),
                "city": snapshot.get("city"),
                "province": snapshot.get("province"),
                "country": snapshot.get("country"),
                "guestRating": snapshot.get("guestRating"),
                "facetListingTexts": snapshot.get("facetListingTexts", {}),
                "reviews": snapshot.get("reviews", []),
                "demoFlags": entry.get("demoFlags", ["demo", "expedia_seed"]),
                "demoScenario": entry.get("demoScenario"),
                "importedAt": generated_at,
            }
            artifact_properties.append(property_payload)
            report.append(
                {
                    "index": index,
                    "propertyId": property_id,
                    "status": "success",
                    "reviewCount": len(property_payload["reviews"]),
                    "sourceUrl": snapshot["sourceUrl"],
                }
            )
        except Exception as exc:  # noqa: BLE001
            report.append(
                {
                    "index": index,
                    "propertyId": property_id,
                    "status": "error",
                    "error": str(exc),
                    "sourceUrl": url,
                }
            )
        time.sleep(0.4)

    output = {
        "generatedAt": generated_at,
        "source": "firecrawl_openai",
        "requestedCount": len(selected),
        "successfulCount": len(artifact_properties),
        "reviewExtractionCount": sum(len(item["reviews"]) > 0 for item in artifact_properties),
        "properties": artifact_properties,
        "report": report,
    }
    output_path.write_text(json.dumps(output, indent=2))
    print(f"\nWrote {len(artifact_properties)} properties to {output_path}")
    print(
        f"Review extraction succeeded for "
        f"{sum(len(item['reviews']) > 0 for item in artifact_properties)}/{len(artifact_properties)} imported properties."
    )


def firecrawl_scrape(url: str, api_key: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for only_main_content in (True, False):
        payload = {
            "url": url,
            "formats": ["markdown", "html"],
            "onlyMainContent": only_main_content,
        }
        try:
            response = http_json(
                "https://api.firecrawl.dev/v1/scrape",
                payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if response.get("success") and response.get("data"):
                return response["data"]
            last_error = RuntimeError("Firecrawl did not return scrape data.")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(str(last_error or "Firecrawl scrape failed."))


def extract_snapshot_with_openai(
    client: OpenAI,
    model: str,
    scrape: dict[str, Any],
    source_url: str,
) -> dict[str, Any]:
    markdown = str(scrape.get("markdown") or "")
    html = str(scrape.get("html") or "")
    metadata = scrape.get("metadata") or {}
    trimmed_markdown = markdown[:20000]
    trimmed_html = html[:12000]

    prompt = {
        "sourceUrl": source_url,
        "metadata": {
            "title": metadata.get("title"),
            "description": metadata.get("description"),
        },
        "runtimeFacets": RUNTIME_FACETS,
        "instructions": [
            "Extract a hotel/property snapshot from Expedia page content.",
            "Return JSON only.",
            "Do not invent reviews; if review text is not visible, return reviews as [].",
            "facetListingTexts keys must come only from runtimeFacets.",
            "popularAmenities should be a comma-separated string if present.",
            "propertySummary should be one concise paragraph.",
            "Include at most 12 reviews.",
            "reviewDate should be ISO date YYYY-MM-DD when recoverable.",
            "guestRating should be numeric if clearly present.",
        ],
        "markdown": trimmed_markdown,
        "html": trimmed_html,
    }

    completion = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract structured Expedia property snapshots for offline seeding. "
                    "Return valid JSON with keys: sourceUrl, propertySummary, popularAmenities, city, province, "
                    "country, guestRating, facetListingTexts, reviews."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(prompt),
            },
        ],
    )
    content = completion.choices[0].message.content
    if not content:
        raise RuntimeError("OpenAI returned no structured extraction.")
    raw = json.loads(content)
    return normalize_snapshot(raw, source_url)


def normalize_snapshot(raw: dict[str, Any], source_url: str) -> dict[str, Any]:
    facet_listing_texts = raw.get("facetListingTexts") or {}
    if not isinstance(facet_listing_texts, dict):
        facet_listing_texts = {}
    facet_listing_texts = {
        key: str(value).strip()
        for key, value in facet_listing_texts.items()
        if key in RUNTIME_FACETS and isinstance(value, str) and value.strip()
    }

    reviews = []
    for review in raw.get("reviews", []) or []:
        if not isinstance(review, dict):
            continue
        text = str(review.get("text") or "").strip()
        if len(text) < 20:
            continue
        item = {"text": text}
        if review.get("headline"):
            item["headline"] = str(review["headline"]).strip()
        if review.get("rating") not in (None, ""):
            try:
                item["rating"] = float(review["rating"])
            except Exception:  # noqa: BLE001
                pass
        if review.get("reviewDate"):
            item["reviewDate"] = str(review["reviewDate"]).strip()
        if review.get("reviewerType"):
            item["reviewerType"] = str(review["reviewerType"]).strip()
        reviews.append(item)

    property_summary = str(raw.get("propertySummary") or "").strip()
    if not property_summary:
        raise RuntimeError("OpenAI extraction did not produce propertySummary.")

    normalized = {
        "sourceUrl": str(raw.get("sourceUrl") or source_url).strip(),
        "propertySummary": property_summary,
        "facetListingTexts": facet_listing_texts,
        "reviews": reviews[:12],
    }
    for field in ("popularAmenities", "city", "province", "country"):
        value = raw.get(field)
        if isinstance(value, str) and value.strip():
            normalized[field] = value.strip()
    if raw.get("guestRating") not in (None, ""):
        try:
            normalized["guestRating"] = float(raw["guestRating"])
        except Exception:  # noqa: BLE001
            pass
    return normalized


def http_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)
    req = request.Request(url, data=body, headers=request_headers, method="POST")
    try:
        with request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {details[:400]}") from exc


def load_env(root: Path) -> None:
    for name in (".env.local", ".env"):
        path = root / name
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


def hashed_property_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
