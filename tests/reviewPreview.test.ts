import { describe, expect, it } from "vitest";

import {
  DEFAULT_REVIEW_CONFIRMATION_PROMPT,
  normalizeReviewPreviewPayload,
} from "../src/lib/reviewPreview";

describe("normalizeReviewPreviewPayload", () => {
  it("keeps a complete preview payload intact", () => {
    const preview = normalizeReviewPreviewPayload({
      reviewText: "Parking was limited, but breakfast was nice.",
      factCandidates: [
        {
          id: "fact_1",
          facet: "amenities_parking",
          factType: "review_detail",
          value: "Parking was limited",
          confidence: 0.52,
          source: "draft_review",
          sourceText: "Parking was limited",
          editable: true,
          selectedByDefault: true,
        },
      ],
      confirmationPrompt: "Looks right?",
    });

    expect(preview).toEqual({
      reviewText: "Parking was limited, but breakfast was nice.",
      factCandidates: [
        {
          id: "fact_1",
          facet: "amenities_parking",
          factType: "review_detail",
          value: "Parking was limited",
          confidence: 0.52,
          source: "draft_review",
          sourceText: "Parking was limited",
          editable: true,
          selectedByDefault: true,
        },
      ],
      confirmationPrompt: "Looks right?",
    });
  });

  it("fills in missing preview fields with safe defaults", () => {
    const preview = normalizeReviewPreviewPayload(
      {
        reviewText: "Parking was limited but breakfast was nice",
      },
      {
        draftReview: "Parking was limited but breakfast was nice",
        overallRating: 7,
      },
    );

    expect(preview).toEqual({
      reviewText: "Parking was limited but breakfast was nice",
      factCandidates: [],
      confirmationPrompt: DEFAULT_REVIEW_CONFIRMATION_PROMPT,
    });
  });

  it("builds a fallback review when the payload is null", () => {
    const preview = normalizeReviewPreviewPayload(null, {
      draftReview: "The parking was limited, but breakfast was nice and staff was nice",
      answers: ["it was limited"],
      overallRating: 7,
    });

    expect(preview).toEqual({
      reviewText:
        "The parking was limited, but breakfast was nice and staff was nice it was limited. I'd rate this stay 7 out of 10.",
      factCandidates: [],
      confirmationPrompt: DEFAULT_REVIEW_CONFIRMATION_PROMPT,
    });
  });
});
