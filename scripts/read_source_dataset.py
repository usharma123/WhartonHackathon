#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def main() -> None:
    properties = load_properties(DATA / "Description_PROC.csv")
    reviews = load_reviews(DATA / "Reviews_PROC.csv")
    print(
        json.dumps(
            {
                "properties": properties,
                "reviews": reviews,
            }
        )
    )


def load_properties(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return [
            {
                "propertyId": row["eg_property_id"] or "",
                "guestRatingAvgExpedia": row["guestrating_avg_expedia"] or "",
                "city": row["city"] or "",
                "province": row["province"] or "",
                "country": row["country"] or "",
                "starRating": row["star_rating"] or "",
                "areaDescription": row["area_description"] or "",
                "propertyDescription": row["property_description"] or "",
                "popularAmenitiesList": row["popular_amenities_list"] or "",
                "propertyAmenityAccessibility": row["property_amenity_accessibility"] or "",
                "propertyAmenityActivitiesNearby": row["property_amenity_activities_nearby"] or "",
                "propertyAmenityBusinessServices": row["property_amenity_business_services"] or "",
                "propertyAmenityConveniences": row["property_amenity_conveniences"] or "",
                "propertyAmenityFamilyFriendly": row["property_amenity_family_friendly"] or "",
                "propertyAmenityFoodAndDrink": row["property_amenity_food_and_drink"] or "",
                "propertyAmenityGuestServices": row["property_amenity_guest_services"] or "",
                "propertyAmenityInternet": row["property_amenity_internet"] or "",
                "propertyAmenityLangsSpoken": row["property_amenity_langs_spoken"] or "",
                "propertyAmenityMore": row["property_amenity_more"] or "",
                "propertyAmenityOutdoor": row["property_amenity_outdoor"] or "",
                "propertyAmenityParking": row["property_amenity_parking"] or "",
                "propertyAmenitySpa": row["property_amenity_spa"] or "",
                "propertyAmenityThingsToDo": row["property_amenity_things_to_do"] or "",
                "checkInStartTime": row["check_in_start_time"] or "",
                "checkInEndTime": row["check_in_end_time"] or "",
                "checkOutTime": row["check_out_time"] or "",
                "checkOutPolicy": row["check_out_policy"] or "",
                "petPolicy": row["pet_policy"] or "",
                "childrenAndExtraBedPolicy": row["children_and_extra_bed_policy"] or "",
                "checkInInstructions": row["check_in_instructions"] or "",
                "knowBeforeYouGo": row["know_before_you_go"] or "",
            }
            for row in reader
        ]


def load_reviews(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return [
            {
                "propertyId": row["eg_property_id"] or "",
                "acquisitionDate": row["acquisition_date"] or "",
                "lob": row["lob"] or "",
                "ratingJson": row["rating"] or "",
                "reviewTitle": row["review_title"] or "",
                "reviewText": row["review_text"] or "",
            }
            for row in reader
        ]


if __name__ == "__main__":
    main()
