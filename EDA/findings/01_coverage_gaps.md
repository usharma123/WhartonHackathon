# Finding 01 — Coverage Gaps

## Dataset shape
- **13 properties**, **5,999 reviews**, Feb 2023 → Feb 2026.
- Perfect 1:M join on `eg_property_id`.
- Per-property volume: min 8, median 152, max 1,094 — heavy skew → cold-start matters.

## Review text is short and often missing
- `review_text` empty rate: **29.0%**
- `review_title` empty rate: **92.7%**
- Text length: median **58 chars**, mean **114 chars** — short enough that a 1-question follow-up is not intrusive.

**Implication for product:** the empty-title field is the natural surface for the follow-up UI — it's already visible, already focused in most UIs, and 93% of users skip it today.

## Rating sub-dimension coverage is shockingly sparse
The `rating` JSON contains 15 sub-dimensions. Most are zero (= no rating given):

| Sub-dimension | % of reviews with a non-zero value |
|---|---|
| overall | ~70% |
| roomcleanliness, service, roomcomfort | 30–50% |
| location, checkin, communication, valueformoney | <15% |
| ecofriendliness, onlinelisting | <5% |

See `charts/05_rating_subdimension_coverage.png`.

**Implication:** we cannot rely on structured sub-ratings as a coverage signal — they're too sparse. Text-based facet detection is the primary input to the scoring layer.

## MVP-facet mention rates (overall)
From `charts/06_facet_mention_rates.png`:

| Facet | % reviews mentioning | Status |
|---|---|---|
| pet | 0.5% | **Critical gap** |
| amenities_gym | 0.6% | **Critical gap** |
| amenities_wifi | 1.1% | **Critical gap** |
| check_out | 1.4% | **Critical gap** |
| children_extra_bed | 2.3% | Gap |
| know_before_you_go | 3.9% | Gap |
| amenities_pool | 4.6% | Gap |
| amenities_parking | 4.8% | Gap |
| amenities_breakfast | 8.6% | Weak coverage |
| check_in | 8.7% | Weak coverage |

**No facet exceeds 10% coverage in free-text reviews.** That is the core opportunity: travel reviews describe "how I felt" far more than "what the property actually offers."

## The high-value target list
These are the facets ReviewGap should ask about first, weighted by (a) business importance, (b) reviewability (travelers can actually answer), (c) gap severity:

1. **pet policy** — stated in listing, almost never confirmed by reviewers; fee disputes common.
2. **check_out** — time-sensitive, often changes (seasonal); invisible in review corpus.
3. **amenities_wifi / gym / pool status** — physical state changes (broken, closed) stale quickly.
4. **children_extra_bed** — listed in policy, never tested in reviews.
5. **know_before_you_go** — construction/noise/unexpected fees — highest-signal negative space.
