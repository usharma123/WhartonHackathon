# ReviewGap Manual Ranker Rubric

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
