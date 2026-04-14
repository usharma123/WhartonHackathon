"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { startTransition, useEffect, useMemo, useState } from "react";

import { api } from "../convex/_generated/api";

type DemoProperty = {
  propertyId: string;
  city?: string;
  province?: string;
  country?: string;
  propertySummary: string;
  demoFlags: string[];
  demoScenario?: string;
};

export default function HomePage() {
  const properties = useQuery(api.reviewGap.listDemoProperties, {}) as DemoProperty[] | undefined;
  const createReviewSession = useMutation(api.reviewGap.createReviewSession);
  const analyzeDraftReview = useAction(api.reviewGap.analyzeDraftReview);
  const selectNextQuestion = useAction(api.reviewGap.selectNextQuestion);
  const submitFollowUpAnswer = useAction(api.reviewGap.submitFollowUpAnswer);

  const [propertyId, setPropertyId] = useState<string>("");
  const [draftReview, setDraftReview] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [question, setQuestion] = useState<any>(null);
  const [answerText, setAnswerText] = useState("");
  const [answerResult, setAnswerResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId && properties && properties.length > 0) {
      setPropertyId(properties[0]!.propertyId);
    }
  }, [properties, propertyId]);

  const sessionSummary = useQuery(
    api.reviewGap.getSessionSummary,
    sessionId ? { sessionId } : "skip",
  );

  const selectedProperty = useMemo(
    () => properties?.find((property: DemoProperty) => property.propertyId === propertyId) ?? null,
    [properties, propertyId],
  );

  async function handleAnalyzeAndAsk() {
    if (!propertyId || !draftReview.trim()) {
      setError("Choose a demo property and write a review draft first.");
      return;
    }
    setIsRunning(true);
    setError(null);
    try {
      const createdSession =
        sessionId && selectedProperty?.propertyId === propertyId
          ? { sessionId }
          : await createReviewSession({ propertyId, draftReview });
      const nextSessionId = createdSession.sessionId;
      startTransition(() => {
        setSessionId(nextSessionId);
        setAnswerResult(null);
      });
      const nextAnalysis = await analyzeDraftReview({
        sessionId: nextSessionId,
        draftReview,
      });
      const nextQuestion = await selectNextQuestion({
        sessionId: nextSessionId,
        draftReview,
      });
      startTransition(() => {
        setAnalysis(nextAnalysis);
        setQuestion(nextQuestion);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to analyze the draft review.");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleAnswerSubmit() {
    if (!sessionId || !question?.facet || !answerText.trim()) {
      setError("Ask a question first, then enter an answer.");
      return;
    }
    setIsAnswering(true);
    setError(null);
    try {
      const result = await submitFollowUpAnswer({
        sessionId,
        facet: question.facet,
        answerText,
      });
      startTransition(() => {
        setAnswerResult(result);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to submit the follow-up answer.");
    } finally {
      setIsAnswering(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">ReviewGap Demo Engine</p>
          <h1>Live review-aware follow-up questions, with deterministic ranking and ML-assisted review understanding.</h1>
          <p className="lede">
            Pick a seeded property, write a live review, let the engine analyze what you already covered,
            then inspect the exact evidence and score that drove the follow-up.
          </p>
        </div>
        <div className="hero-card">
          <span>Runtime stack</span>
          <strong>Next.js + Convex + OpenAI</strong>
          <span>Offline ML</span>
          <strong>Exported TF-IDF logistic classifier</strong>
        </div>
      </section>

      <section className="grid">
        <div className="panel review-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">1. Draft Review</p>
              <h2>Write the review you want to test</h2>
            </div>
          </div>

          <label className="field">
            <span>Curated demo property</span>
            <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
              <option value="">Select a seeded scenario</option>
              {properties?.map((property: DemoProperty) => (
                <option key={property.propertyId} value={property.propertyId}>
                  {property.demoScenario?.replaceAll("_", " ")} · {property.city}, {property.country}
                </option>
              ))}
            </select>
          </label>

          <div className="property-blurb">
            <p className="property-title">
              {selectedProperty?.city ? `${selectedProperty.city}, ${selectedProperty.country}` : "No property selected"}
            </p>
            <p>{selectedProperty?.propertySummary ?? "Seed the demo data and select a property to begin."}</p>
          </div>

          <label className="field">
            <span>Review draft</span>
            <textarea
              value={draftReview}
              onChange={(event) => setDraftReview(event.target.value)}
              rows={9}
              placeholder="Example: Check-in took forever, but the room was clean and quiet."
            />
          </label>

          <div className="actions">
            <button className="primary-button" onClick={handleAnalyzeAndAsk} disabled={isRunning}>
              {isRunning ? "Analyzing..." : "Analyze + Ask"}
            </button>
            <span className="status-copy">
              {sessionId ? `Session ${sessionId}` : "No live session created yet"}
            </span>
          </div>

          {error ? <p className="error-banner">{error}</p> : null}
        </div>

        <div className="stack">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">2. Review Understanding</p>
                <h2>What the engine thinks you already covered</h2>
              </div>
            </div>

            <div className="chip-row">
              {(analysis?.mentionedFacets ?? []).map((facet: string) => (
                <span className="chip" key={facet}>
                  {facet.replaceAll("_", " ")}
                </span>
              ))}
              {analysis?.mentionedFacets?.length === 0 ? <span className="muted">No facets detected yet.</span> : null}
            </div>

            <div className="stats-grid">
              <Stat label="Sentiment" value={analysis?.sentiment ?? "n/a"} />
              <Stat label="Used ML" value={analysis?.usedML ? "yes" : "no"} />
              <Stat label="Used OpenAI" value={analysis?.usedOpenAI ? "yes" : "no"} />
              <Stat label="Used fallback" value={analysis?.usedFallback ? "yes" : "no"} />
            </div>

            <ProbabilityList
              title="ML mention probabilities"
              values={analysis?.mlMentionProbByFacet}
            />
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">3. Follow-up</p>
                <h2>The next question chosen by the ranker</h2>
              </div>
            </div>

            {question?.noFollowUp ? (
              <p className="muted">{question.whyThisQuestion}</p>
            ) : (
              <>
                <p className="facet-badge">{question?.facet?.replaceAll("_", " ") ?? "No facet selected"}</p>
                <p className="question-copy">{question?.questionText ?? "No question yet."}</p>
                <p className="voice-copy">Voice: {question?.voiceText ?? "n/a"}</p>
                <div className="why-box">
                  <h3>Why asked</h3>
                  <p>{question?.whyThisQuestion ?? "No deterministic explanation yet."}</p>
                </div>
                <ScoreBreakdown scoreBreakdown={question?.scoreBreakdown} />
                <EvidenceList evidence={question?.supportingEvidence} />
                <div className="source-line">
                  <span>Question source</span>
                  <strong>
                    {question?.questionSource?.usedOpenAI
                      ? "OpenAI phrasing"
                      : question?.questionSource?.usedFallback
                        ? "Deterministic template"
                        : "n/a"}
                  </strong>
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">4. Answer Capture</p>
                <h2>Submit the follow-up answer</h2>
              </div>
            </div>

            <label className="field">
              <span>Answer text</span>
              <textarea
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
                rows={5}
                placeholder="Example: Parking was tight and we had to pay $18 for a small lot."
              />
            </label>

            <div className="actions">
              <button className="primary-button" onClick={handleAnswerSubmit} disabled={isAnswering}>
                {isAnswering ? "Saving..." : "Submit Answer"}
              </button>
            </div>

            {answerResult ? (
              <div className="answer-card">
                <p>{answerResult.propertyCardDelta.summary}</p>
                <div className="chip-row">
                  {answerResult.structuredFacts.map((fact: any, index: number) => (
                    <span className="chip" key={`${fact.factType}-${index}`}>
                      {fact.factType}: {String(fact.value)}
                    </span>
                  ))}
                </div>
                <div className="source-line">
                  <span>Answer extraction</span>
                  <strong>{answerResult.usedOpenAI ? "OpenAI" : "Fallback"}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">No answer submitted yet.</p>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">5. Session Summary</p>
                <h2>Persisted evidence captured by the backend</h2>
              </div>
            </div>

            <pre className="summary-block">
              {JSON.stringify(sessionSummary ?? { status: "No persisted session yet." }, null, 2)}
            </pre>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProbabilityList({
  title,
  values,
}: {
  title: string;
  values: Record<string, number> | undefined;
}) {
  const entries = Object.entries(values ?? {}).sort((left, right) => right[1] - left[1]);
  return (
    <div className="probability-list">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="muted">No ML probabilities available yet.</p>
      ) : (
        entries.map(([facet, value]) => (
          <div key={facet} className="probability-row">
            <span>{facet.replaceAll("_", " ")}</span>
            <strong>{value.toFixed(3)}</strong>
          </div>
        ))
      )}
    </div>
  );
}

function ScoreBreakdown({
  scoreBreakdown,
}: {
  scoreBreakdown:
    | {
        importance: number;
        staleness: number;
        conflict: number;
        coverageGap: number;
        matchedSupportGap: number;
        alreadyMentionedPenalty: number;
        reviewerKnowsBoost: number;
        total: number;
      }
    | null
    | undefined;
}) {
  if (!scoreBreakdown) {
    return null;
  }
  const entries = Object.entries(scoreBreakdown);
  return (
    <div className="score-grid">
      {entries.map(([key, value]) => (
        <div key={key} className="score-card">
          <span>{key}</span>
          <strong>{Number(value).toFixed(3)}</strong>
        </div>
      ))}
    </div>
  );
}

function EvidenceList({
  evidence,
}: {
  evidence:
    | Array<{ sourceType: string; snippet: string; acquisitionDate?: string }>
    | null
    | undefined;
}) {
  if (!evidence || evidence.length === 0) {
    return <p className="muted">No supporting evidence attached.</p>;
  }
  return (
    <div className="evidence-list">
      <h3>Supporting evidence</h3>
      {evidence.map((item, index) => (
        <div className="evidence-item" key={`${item.sourceType}-${index}`}>
          <span>{item.sourceType.replaceAll("_", " ")}</span>
          <p>{item.snippet}</p>
          {item.acquisitionDate ? <small>{item.acquisitionDate}</small> : null}
        </div>
      ))}
    </div>
  );
}
