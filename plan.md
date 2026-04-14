from pathlib import Path

content = """# Project Context: Review-Aware Adaptive Follow-Up for Travel Reviews

## Project Summary
We are building a reviewer-first AI system for the 2026 Wharton Hack-AI-thon challenge.

The goal is to improve the hotel review process by asking a traveler **1-2 smart follow-up questions** while they are already leaving a review. These follow-up questions should feel low-friction, work through text or voice, and help collect property information that is currently missing, stale, or unclear.

Our proposed concept is:

## Working Concept
**ReviewGap**  
An AI assistant that reads the review in progress, detects what the reviewer has already covered, checks what important property information is still missing or outdated, and asks **one short follow-up question** that the reviewer is most likely able to answer.

### Core idea
The user is **the reviewer**, not the future traveler.  
So the system should not ask broad or random questions. It should ask the **easiest high-value missing detail** based on:
- what the reviewer already said,
- what the property listing currently says,
- what recent reviews have or have not confirmed.

Example:
- Reviewer writes: “Check-in was smooth and the room was clean.”
- System asks: “One quick thing: were there any unexpected pet fees or restrictions?”

---

## Problem We Are Solving
Travel reviews are useful, but they are incomplete and inconsistent:
- some topics get repeated too much,
- some important facts are rarely mentioned,
- some property facts go stale over time,
- static review prompts do not adapt to the property or the reviewer.

This creates a gap between what future guests need to know and what the review system actually captures.

Our project solves this by generating targeted follow-up questions in real time during review submission.

---

## Why This Idea Fits the Data
We have two key datasets:

### 1. `Description_PROC`
Structured property information, including:
- property id
- location
- rating
- property description
- amenities
- check-in and check-out details
- pet policy
- children and extra bed policy
- check-in instructions
- know-before-you-go notes

### 2. `Reviews_PROC`
Property review history, including:
- property id
- review submission date
- line of business
- rating
- review title
- review text

### Why this is useful
This lets us compare:
- the **official property description**
- with **time-stamped guest review evidence**
- and the **current review in progress**

That means we can estimate which property facts are:
- under-covered,
- conflicting,
- or likely stale.

---

## Product Vision
When a traveler submits a review, the system should:
1. read the in-progress review,
2. detect topics already covered,
3. identify one high-value information gap for that property,
4. generate one short follow-up question,
5. capture the answer,
6. convert the answer into structured evidence that can refresh property understanding.

This creates a review flow that is:
- personalized,
- lightweight,
- useful for the business,
- and more valuable for future travelers.

---

## Reviewer Experience
### Reviewer flow
1. Reviewer types or speaks a normal review.
2. AI analyzes the review in progress.
3. AI asks one short contextual follow-up.
4. Reviewer answers in one sentence or skips.
5. System stores the answer as fresh property evidence.

### Example flow
**Reviewer review:**  
“The room was clean and check-in was easy.”

**AI follow-up:**  
“One quick question: was the pool open and usable during your stay?”

**Reviewer answer:**  
“Yes, it was open, but it closed earlier than expected.”

**System result:**  
Adds fresh structured evidence related to pool availability and usage.

---

## What Makes This Unique
Most teams will likely build a generic AI question generator.

Our differentiation is:
- we are **review-aware**, not just property-aware,
- we ask the **single best next question**, not a random extra question,
- we combine structured property data with recent review evidence,
- we turn reviewer answers into structured refresh signals for the property.

This makes the system feel more intelligent and more practical.

---

## Core Features
## 1. Review understanding
Parse the review in progress and identify which topics the reviewer already mentioned.

## 2. Property gap detection
For each property, determine which important topics are:
- stale,
- missing,
- conflicting,
- or weakly covered.

## 3. Smart follow-up selection
Choose the highest-value question that:
- is relevant to this property,
- is not already answered in the review,
- is easy for the reviewer to answer,
- improves property information quality.

## 4. Natural question generation
Use the ChatGPT API to phrase the follow-up naturally for text or voice.

## 5. Answer-to-fact extraction
Convert the reviewer’s answer into structured evidence such as:
- pool_open_recently = true
- pet_fee_reported = true
- late_checkin_smooth = false

## 6. Optional refreshed property card
Show how the new answer updates the property understanding.

---

## Best Property Facets to Start With
These are the cleanest and most demo-friendly areas from the dataset:
- pet policy
- check-in process
- check-out process
- amenities
- children / extra bed policy
- check-in instructions
- know-before-you-go issues

These are good because they exist in the structured property data and are also likely to appear in review text.

---

## Recommended Technical Approach

## A. Deterministic layer
Use rules and scoring logic to identify candidate gaps.

### Inputs
- `Description_PROC`
- `Reviews_PROC`
- current review text or transcript

### Tasks
- join data by `eg_property_id`
- group property facts into topic buckets
- use `acquisition_date` to estimate freshness
- detect mentions in past reviews
- measure topic coverage
- detect conflicting review evidence
- determine which topic is best to ask about

### Example scoring idea
`priority = importance + staleness + conflict + low_coverage`

---

## B. LLM layer using ChatGPT API
Use the model only where it adds value.

### Use the API for:
- rewriting a selected question naturally,
- adapting tone for voice or text,
- extracting structured information from reviewer answers,
- generating a short summary of what was learned.

### Do not use the API for:
- all ranking logic,
- all data matching,
- everything end to end.

A hybrid system will look much more robust.

---

## Suggested MVP
The MVP should stay narrow.

### MVP scope
- support text review input first
- support 3-5 property facets
- ask only 1 follow-up question
- use simple scoring instead of a complex ranking model
- show a before/after property fact card

### Best MVP demo scenario
1. Property has stale or conflicting information.
2. Reviewer writes a short review.
3. System detects one unresolved topic.
4. AI asks one targeted question.
5. Reviewer answers.
6. UI shows updated property evidence.

---

## What Has To Be Done

## 1. Data preparation
- load both datasets
- inspect schema and null values
- join by `eg_property_id`
- create topic buckets for structured property fields
- clean review text
- map reviews to properties over time

## 2. Gap scoring logic
- define the initial set of property facets
- create rules for coverage
- create rules for staleness
- create rules for conflict
- rank which facet should be asked about

## 3. Review parsing
- detect what the current reviewer already mentioned
- avoid asking about already-covered topics
- determine whether the reviewer seems able to answer the candidate question

## 4. LLM prompting
- write prompt for natural follow-up generation
- write prompt for answer extraction into structured fields
- write prompt for optional voice-friendly phrasing

## 5. Frontend prototype
- review input box or voice input
- follow-up question UI
- answer capture UI
- refreshed property info panel
- simple explanation of why the question was asked

## 6. Backend / API
- endpoint for review analysis
- endpoint for selecting the best follow-up
- endpoint for processing reviewer answer
- endpoint for returning updated fact summary

## 7. Demo data and scenarios
- choose 2-3 strong property examples
- create one pet policy example
- create one amenity freshness example
- create one check-in/check-out example

## 8. Evaluation
- measure whether the selected question is relevant
- measure whether the question was not already answered
- measure whether the answer improves property coverage
- measure skip rate or friction in the demo

## 9. Deliverables
- working public prototype
- GitHub repository
- 3-5 minute demo video
- 8-12 slide pitch deck
- optional supporting materials

---

## Immediate Build Plan
## Day 1
- inspect data
- pick 3-5 property facets
- build simple scoring logic
- design prototype flow
- implement basic text-based UI

## Day 2
- integrate ChatGPT API
- generate follow-up questions
- extract structured answers
- create refreshed property card
- prepare demo scenario

## Day 3
- polish UX
- record demo
- finish slides
- clean README
- test end-to-end flow

---

## Suggested Team Split
### Person 1: Data / ranking
- data cleaning
- scoring logic
- topic mapping

### Person 2: LLM / prompts
- question generation
- answer extraction
- prompt iteration

### Person 3: Frontend / UX
- review flow UI
- answer capture
- before/after property display

### Person 4: Demo / presentation
- pitch story
- deck
- recorded walkthrough
- README and submission assembly

---

## Risks and How To Avoid Them
### Risk: asking bad or random questions
Fix:
- only ask from a small approved set of property facets
- filter against topics already mentioned in the review

### Risk: overusing the LLM
Fix:
- keep ranking deterministic
- use the model mainly for phrasing and extraction

### Risk: trying to support too many cases
Fix:
- focus on one simple reviewer journey
- keep the MVP narrow

### Risk: weak demo
Fix:
- choose curated examples where stale or conflicting information is obvious

---

## Final Positioning
**ReviewGap helps travel platforms ask each reviewer one extra question that actually matters.**

Instead of static prompts, it uses property context, review history, and the current review in progress to ask the easiest high-value follow-up question and turn the answer into fresher property knowledge.

---

## One-Sentence Pitch
**ReviewGap is a reviewer-aware AI assistant that asks one targeted follow-up question during review submission to refresh missing, stale, or conflicting hotel information.**
"""

path = Path("/mnt/data/reviewgap_project_context.md")
path.write_text(content, encoding="utf-8")

print(f"Saved to {path}")