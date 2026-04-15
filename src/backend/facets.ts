export const PRIMARY_AUTO_SELECT_FACETS = [
  "check_in",
  "check_out",
  "amenities_breakfast",
  "amenities_parking",
] as const;

export const SECONDARY_AUTO_SELECT_FACETS = [
  "know_before_you_go",
  "amenities_pool",
] as const;

export const BLOCKED_AUTO_SELECT_FACETS = [
  "pet",
  "children_extra_bed",
  "amenities_wifi",
  "amenities_gym",
] as const;

export const ALL_RUNTIME_FACETS = [
  ...PRIMARY_AUTO_SELECT_FACETS,
  ...SECONDARY_AUTO_SELECT_FACETS,
  ...BLOCKED_AUTO_SELECT_FACETS,
] as const;

export type RuntimeFacet = (typeof ALL_RUNTIME_FACETS)[number];

export type RuntimeFacetPolicy = {
  importance: number;
  listingFields: readonly string[];
  questionTemplate: string;
  voiceTemplate: string;
  answerHint: string;
  reviewPatterns: readonly RegExp[];
};

const compile = (patterns: readonly string[]): readonly RegExp[] =>
  patterns.map((pattern) => new RegExp(pattern, "i"));

export const FACET_POLICIES: Record<RuntimeFacet, RuntimeFacetPolicy> = {
  check_in: {
    importance: 0.95,
    listingFields: [
      "check_in_start_time",
      "check_in_end_time",
      "check_in_instructions",
    ],
    questionTemplate:
      "One quick question: how did check-in go, especially timing and getting into the room?",
    voiceTemplate:
      "One quick question. How did check-in go, especially timing and getting into the room?",
    answerHint: "Look for wait time, room readiness, key pickup, or front desk friction.",
    reviewPatterns: compile([
      "\\bcheck[ -]?in\\b",
      "\\bfront desk\\b",
      "\\breception\\b",
      "\\broom key\\b",
      "\\bkeycard\\b",
      "\\blobby\\b",
      "\\barriv(?:e|ed|al|ing)\\b",
    ]),
  },
  check_out: {
    importance: 0.84,
    listingFields: ["check_out_time", "check_out_policy"],
    questionTemplate:
      "Before you submit: how did checkout go for you, especially timing or any unexpected charges?",
    voiceTemplate:
      "Before you submit, how did checkout go for you, especially timing or any unexpected charges?",
    answerHint: "Look for checkout timing, charges, flexibility, or late checkout availability.",
    reviewPatterns: compile([
      "\\bcheck[ -]?out\\b",
      "\\bcheckout\\b",
      "\\blate checkout\\b",
      "\\bdepart(?:ure|ed|ing)\\b",
    ]),
  },
  amenities_breakfast: {
    importance: 0.9,
    listingFields: [
      "property_description",
      "popular_amenities_list",
      "property_amenity_food_and_drink",
    ],
    questionTemplate:
      "One more detail: if you had breakfast there, was it actually available and worth it?",
    voiceTemplate:
      "One more detail. If you had breakfast there, was it actually available and worth it?",
    answerHint: "Look for availability, quality, or surprise charges.",
    reviewPatterns: compile([
      "\\bbreakfast\\b",
      "\\bbuffet\\b",
      "\\bcontinental\\b",
      "\\bwaffle\\b",
      "\\bcoffee\\b",
      "\\bsyrup\\b",
    ]),
  },
  amenities_parking: {
    importance: 0.92,
    listingFields: [
      "popular_amenities_list",
      "property_amenity_parking",
      "know_before_you_go",
    ],
    questionTemplate:
      "One quick thing: how was parking in practice, especially space, ease, or any fees?",
    voiceTemplate:
      "One quick thing. How was parking in practice, especially space, ease, or any fees?",
    answerHint: "Look for parking availability, fees, tight spaces, valet, or overflow parking.",
    reviewPatterns: compile([
      "\\bparking\\b",
      "\\bgarage\\b",
      "\\bvalet\\b",
      "\\blot\\b",
      "\\bparked\\b",
    ]),
  },
  know_before_you_go: {
    importance: 0.7,
    listingFields: ["know_before_you_go"],
    questionTemplate:
      "Was there anything about the stay, like noise, fees, or restrictions, that caught you off guard?",
    voiceTemplate:
      "Was there anything about the stay, like noise, fees, or restrictions, that caught you off guard?",
    answerHint: "Look for construction, noise, deposits, restrictions, or unexpected charges.",
    reviewPatterns: compile([
      "\\bconstruction\\b",
      "\\brenovation\\b",
      "\\bfee\\b",
      "\\bdeposit\\b",
      "\\bcharge\\b",
      "\\bnoise\\b",
      "\\bnoisy\\b",
      "\\bunexpected\\b",
    ]),
  },
  amenities_pool: {
    importance: 0.68,
    listingFields: ["popular_amenities_list", "property_amenity_things_to_do", "know_before_you_go"],
    questionTemplate:
      "One last detail: was the pool actually open and usable during your stay?",
    voiceTemplate:
      "One last detail. Was the pool actually open and usable during your stay?",
    answerHint: "Look for pool open status, cleanliness, hours, or closure.",
    reviewPatterns: compile([
      "\\bpool\\b",
      "\\bhot tub\\b",
      "\\bjacuzzi\\b",
      "\\bswimming\\b",
    ]),
  },
  pet: {
    importance: 0.3,
    listingFields: ["pet_policy"],
    questionTemplate:
      "Did you notice anything about the pet policy that future guests should know?",
    voiceTemplate:
      "Did you notice anything about the pet policy that future guests should know?",
    answerHint: "Blocked from MVP auto-selection.",
    reviewPatterns: compile([
      "\\bpet\\b",
      "\\bdog\\b",
      "\\bcat\\b",
      "\\banimal\\b",
    ]),
  },
  children_extra_bed: {
    importance: 0.28,
    listingFields: ["children_and_extra_bed_policy"],
    questionTemplate:
      "Anything notable about children, cribs, or extra bed setup?",
    voiceTemplate:
      "Anything notable about children, cribs, or extra bed setup?",
    answerHint: "Blocked from MVP auto-selection.",
    reviewPatterns: compile([
      "\\bchild(?:ren)?\\b",
      "\\bkids?\\b",
      "\\bcrib\\b",
      "\\bcot\\b",
      "\\bextra bed\\b",
      "\\brollaway\\b",
    ]),
  },
  amenities_wifi: {
    importance: 0.26,
    listingFields: ["popular_amenities_list", "property_amenity_internet"],
    questionTemplate: "How was the Wi-Fi during your stay?",
    voiceTemplate: "How was the Wi-Fi during your stay?",
    answerHint: "Blocked from MVP auto-selection.",
    reviewPatterns: compile([
      "\\bwifi\\b",
      "\\bwi-fi\\b",
      "\\binternet\\b",
      "\\bconnection\\b",
    ]),
  },
  amenities_gym: {
    importance: 0.24,
    listingFields: ["popular_amenities_list", "property_amenity_things_to_do"],
    questionTemplate: "How was the gym or fitness space during your stay?",
    voiceTemplate: "How was the gym or fitness space during your stay?",
    answerHint: "Blocked from MVP auto-selection.",
    reviewPatterns: compile([
      "\\bgym\\b",
      "\\bfitness\\b",
      "\\bworkout\\b",
      "\\bexercise\\b",
    ]),
  },
};

export function isBlockedAutoFacet(facet: RuntimeFacet): boolean {
  return BLOCKED_AUTO_SELECT_FACETS.includes(
    facet as (typeof BLOCKED_AUTO_SELECT_FACETS)[number],
  );
}

export function canAutoSelectFacet(
  facet: RuntimeFacet,
  includeSecondary = false,
): boolean {
  if (
    PRIMARY_AUTO_SELECT_FACETS.includes(
      facet as (typeof PRIMARY_AUTO_SELECT_FACETS)[number],
    )
  ) {
    return true;
  }
  if (
    includeSecondary &&
    SECONDARY_AUTO_SELECT_FACETS.includes(
      facet as (typeof SECONDARY_AUTO_SELECT_FACETS)[number],
    )
  ) {
    return true;
  }
  return false;
}

export function facetLabel(facet: RuntimeFacet): string {
  return facet.replaceAll("_", " ");
}
