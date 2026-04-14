"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

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

type ChatMessage =
  | { id: string; role: "ai"; label?: string; text: string; kind?: "question" | "intro" | "wrapup" }
  | { id: string; role: "user"; text: string };

type Fact = { factType: string; value: unknown };

type View = "property" | "chat";

const PROMPT_STARTER =
  "Tell us how your stay went — the good, the awkward, what we should know.";

export default function HomePage() {
  const properties = useQuery(api.reviewGapPublic.listDemoProperties, {}) as DemoProperty[] | undefined;
  const createReviewSession = useMutation(api.reviewGapPublic.createReviewSession);
  const analyzeDraftReview = useAction(api.reviewGapActions.analyzeDraftReview);
  const selectNextQuestion = useAction(api.reviewGapActions.selectNextQuestion);
  const submitFollowUpAnswer = useAction(api.reviewGapActions.submitFollowUpAnswer);

  const [view, setView] = useState<View>("property");
  const [propertyId, setPropertyId] = useState<string>("");

  // chat state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFacet, setPendingFacet] = useState<string | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [wrappedUp, setWrappedUp] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [followUpCount, setFollowUpCount] = useState(0);
  const [askedFacets, setAskedFacets] = useState<string[]>([]);

  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }, [draft, view]);

  useEffect(() => {
    if (!propertyId && properties && properties.length > 0) {
      setPropertyId(properties[0]!.propertyId);
    }
  }, [properties, propertyId]);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTo({
        top: chatBodyRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages.length, isThinking]);

  const selectedProperty = useMemo(
    () => properties?.find((p) => p.propertyId === propertyId) ?? null,
    [properties, propertyId],
  );

  const otherProperties = useMemo(
    () => (properties ?? []).filter((p) => p.propertyId !== propertyId),
    [properties, propertyId],
  );

  const uid = () => Math.random().toString(36).slice(2, 10);

  function startReview() {
    if (!selectedProperty) return;
    setView("chat");
    setSessionId(null);
    setDraft("");
    setPendingFacet(null);
    setFacts([]);
    setWrappedUp(false);
    setHasDraft(false);
    setFollowUpCount(0);
    setAskedFacets([]);
    setError(null);
    setMessages([
      {
        id: uid(),
        role: "ai",
        kind: "intro",
        text: `Hi — I'm helping capture your stay at ${selectedProperty.city ?? "the property"}. ${PROMPT_STARTER}`,
      },
    ]);
  }

  function backToProperty() {
    setView("property");
  }

  async function sendUserMessage() {
    const trimmed = draft.trim();
    if (!trimmed || isThinking) return;

    // First message = draft review → analyze + ask first follow-up
    if (!hasDraft) {
      setMessages((prev) => [...prev, { id: uid(), role: "user", text: trimmed }]);
      setDraft("");
      setHasDraft(true);
      await runInitialAnalysis(trimmed);
      return;
    }

    // Subsequent messages = answer to the pending follow-up
    if (pendingFacet) {
      setMessages((prev) => [...prev, { id: uid(), role: "user", text: trimmed }]);
      setDraft("");
      await submitAnswer(trimmed);
    }
  }

  async function runInitialAnalysis(draftReview: string) {
    if (!propertyId) return;
    setIsThinking(true);
    setError(null);
    try {
      const session = await createReviewSession({ propertyId, draftReview });
      setSessionId(session.sessionId);
      await analyzeDraftReview({ sessionId: session.sessionId, draftReview });
      const q = await selectNextQuestion({ sessionId: session.sessionId, draftReview });

      if (q?.noFollowUp) {
        setWrappedUp(true);
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "ai",
            kind: "wrapup",
            text:
              q.whyThisQuestion ??
              "That's a complete review — thanks. Future travelers will find this helpful.",
          },
        ]);
      } else if (q?.facet && q?.questionText) {
        const facet: string = q.facet;
        const text: string = q.questionText;
        setPendingFacet(facet);
        setFollowUpCount((n) => n + 1);
        setAskedFacets((prev) => [...prev, facet]);
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "ai",
            kind: "question",
            label: `One quick thing · ${facet.replaceAll("_", " ")}`,
            text,
          },
        ]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsThinking(false);
    }
  }

  async function submitAnswer(answerText: string) {
    if (!sessionId || !pendingFacet) return;
    setIsThinking(true);
    setError(null);
    try {
      const result = await submitFollowUpAnswer({
        sessionId,
        facet: pendingFacet,
        answerText,
      });
      if (result?.structuredFacts?.length) {
        setFacts((prev) => [...prev, ...result.structuredFacts]);
      }

      const summary = result?.propertyCardDelta?.summary;
      if (summary) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "ai",
            label: "Added to the listing",
            text: summary,
          },
        ]);
      }

      // Decide whether to keep going (up to ~3 follow-ups) or wrap.
      const keepGoing = followUpCount < 3;
      if (keepGoing && sessionId) {
        try {
          const draftReview = [...messages, { id: uid(), role: "user" as const, text: answerText }]
            .filter((m) => m.role === "user")
            .map((m) => m.text)
            .join(" ");
          const next = await selectNextQuestion({ sessionId, draftReview });
          if (
            next?.facet &&
            next?.questionText &&
            !next.noFollowUp &&
            next.facet !== pendingFacet &&
            !askedFacets.includes(next.facet)
          ) {
            const facet: string = next.facet;
            const text: string = next.questionText;
            setPendingFacet(facet);
            setFollowUpCount((n) => n + 1);
            setAskedFacets((prev) => [...prev, facet]);
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "ai",
                kind: "question",
                label: `Follow-up · ${facet.replaceAll("_", " ")}`,
                text,
              },
            ]);
            return;
          }
        } catch {
          // fall through to wrap-up
        }
      }

      setPendingFacet(null);
      setWrappedUp(true);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "ai",
          kind: "wrapup",
          text:
            "That's a wrap — your review's ready to post. Thanks for the detail; it helps the next traveler.",
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save your answer.");
    } finally {
      setIsThinking(false);
    }
  }

  function onTextareaKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendUserMessage();
    }
  }

  const canSend = draft.trim().length > 0 && !isThinking && !wrappedUp;
  const sendLabel = !hasDraft ? "send review" : pendingFacet ? "reply" : "send";

  return (
    <>
      <nav className="nav">
        <div className="nav-brand">
          <span className="mark">E</span>
          <div>
            <div>Expedia</div>
            <div className="brand-sub">ReviewGap</div>
          </div>
        </div>
        <div className="nav-links">
          <button
            className={view === "property" ? "active" : ""}
            onClick={() => setView("property")}
          >
            Stay
          </button>
          <button
            className={view === "chat" ? "active" : ""}
            onClick={() => selectedProperty && setView("chat")}
          >
            Review
          </button>
        </div>
      </nav>

      <div className="page">
        {view === "property" ? (
          <PropertyScreen
            properties={properties ?? []}
            selected={selectedProperty}
            otherProperties={otherProperties}
            onSelect={setPropertyId}
            onStart={startReview}
          />
        ) : (
          <ChatScreen
            selected={selectedProperty}
            messages={messages}
            isThinking={isThinking}
            draft={draft}
            onDraftChange={setDraft}
            onSend={sendUserMessage}
            onBack={backToProperty}
            onKey={onTextareaKey}
            canSend={canSend}
            sendLabel={sendLabel}
            facts={facts}
            wrappedUp={wrappedUp}
            hasDraft={hasDraft}
            chatBodyRef={chatBodyRef}
            textareaRef={textareaRef}
            error={error}
          />
        )}
      </div>
    </>
  );
}

/* ────────────────────────── Property screen ────────────────────────── */

function PropertyScreen({
  properties,
  selected,
  otherProperties,
  onSelect,
  onStart,
}: {
  properties: DemoProperty[];
  selected: DemoProperty | null;
  otherProperties: DemoProperty[];
  onSelect: (id: string) => void;
  onStart: () => void;
}) {
  const locationLine = selected
    ? [selected.city, selected.province, selected.country].filter(Boolean).join(" · ")
    : "—";

  const splitName = (city: string | undefined): [string, string] => {
    if (!city) return ["The", "Stay"];
    const parts = city.split(" ");
    if (parts.length === 1) return [parts[0], ""];
    return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
  };

  const [first, last] = splitName(selected?.city);

  return (
    <>
      <section className="property-hero">
        <div className="property-left">
          <div className="property-meta">
            <span>Featured stay</span>
            <span className="divider" />
            {selected?.demoScenario ? (
              <span className="scenario">{selected.demoScenario.replaceAll("_", " ")}</span>
            ) : (
              <span>Curated</span>
            )}
          </div>

          <h1 className="property-title">
            {first} {last ? <em>{last}</em> : null}
          </h1>

          <p className="property-location">
            {locationLine.split(" · ").map((part, idx, arr) => (
              <span key={`${part}-${idx}`}>
                {part}
                {idx < arr.length - 1 ? <span className="dot" /> : null}
              </span>
            ))}
          </p>

          <p className="property-description">
            {selected?.propertySummary ??
              "Select a stay to see its story. Each property tells travelers a different truth — ours is built from real reviews, refined by the people who stayed there."}
          </p>

          <div className="property-stats">
            <div className="property-stat">
              <span className="k">Rating</span>
              <span className="v">
                <span className="star">★</span>4.6
              </span>
            </div>
            <div className="property-stat">
              <span className="k">Reviews</span>
              <span className="v">1,284</span>
            </div>
            <div className="property-stat">
              <span className="k">From</span>
              <span className="v">$248<span style={{ fontSize: "0.8rem", color: "var(--bone-faint)", marginLeft: 4 }}>/ night</span></span>
            </div>
          </div>

          <button className="cta-primary" onClick={onStart} disabled={!selected}>
            Write a review
            <span className="arrow">→</span>
          </button>
        </div>

        <div className="property-visual">
          <div className="visual-frame">
            <span className="frame-tag">Live from travelers</span>
            <span className="frame-quote-mark">&ldquo;</span>
            <div className="frame-mono">
              {selected?.city ? (
                <>
                  A stay in <span>{selected.city}</span> is only as honest as the last reviewer&rsquo;s memory.
                </>
              ) : (
                <>A good review is a <span>gift</span> to the next traveler.</>
              )}
            </div>
          </div>
          <div className="amenities">
            {(selected?.demoFlags ?? ["wifi", "breakfast", "gym", "pool", "pet friendly"]).slice(0, 6).map((flag) => (
              <span className="amenity-chip" key={flag}>
                {flag.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        </div>
      </section>

      {properties.length > 0 ? (
        <section className="other-properties">
          <div className="section-title">
            <h2>
              Or choose <em>another</em> stay
            </h2>
            <span className="caption">{properties.length} curated</span>
          </div>

          <div className="property-row">
            {properties.map((p) => (
              <button
                key={p.propertyId}
                className={`property-tile ${p.propertyId === selected?.propertyId ? "active" : ""}`}
                onClick={() => onSelect(p.propertyId)}
                type="button"
              >
                <div className="tile-head">
                  <span>{p.country ?? "—"}</span>
                  {p.demoScenario ? (
                    <span className="scenario">{p.demoScenario.replaceAll("_", " ")}</span>
                  ) : null}
                </div>
                <h3 className="tile-name">{p.city ?? "Property"}</h3>
                <p className="tile-loc">
                  {[p.province, p.country].filter(Boolean).join(" · ")}
                </p>
                <p className="tile-summary">{p.propertySummary}</p>
                <span className="tile-arrow">View stay</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/* ────────────────────────── Chat screen ────────────────────────── */

function ChatScreen({
  selected,
  messages,
  isThinking,
  draft,
  onDraftChange,
  onSend,
  onBack,
  onKey,
  canSend,
  sendLabel,
  facts,
  wrappedUp,
  hasDraft,
  chatBodyRef,
  textareaRef,
  error,
}: {
  selected: DemoProperty | null;
  messages: ChatMessage[];
  isThinking: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onBack: () => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  canSend: boolean;
  sendLabel: string;
  facts: Fact[];
  wrappedUp: boolean;
  hasDraft: boolean;
  chatBodyRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  error: string | null;
}) {
  return (
    <div className="chat-screen">
      {/* Main conversation */}
      <div className="chat-main">
        <div className="chat-header">
          <button className="chat-back" onClick={onBack}>
            ← back to stay
          </button>
          <div className="chat-header-title">
            Reviewing <em>{selected?.city ?? "your stay"}</em>
          </div>
          <div className="chat-header-status">
            <span className="dot" />
            {isThinking ? "thinking" : wrappedUp ? "complete" : "listening"}
          </div>
        </div>

        <div className="chat-body" ref={chatBodyRef}>
          {messages.map((m) =>
            m.role === "ai" ? (
              <div className="msg ai" key={m.id}>
                <div className="msg-avatar">R</div>
                <div className="msg-bubble">
                  {m.label ? <span className="label">{m.label}</span> : null}
                  {m.kind === "question" ? (
                    <div className="question">
                      {m.text}
                    </div>
                  ) : (
                    <div>{m.text}</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="msg user" key={m.id}>
                <div className="msg-avatar">You</div>
                <div className="msg-bubble">{m.text}</div>
              </div>
            ),
          )}

          {isThinking ? (
            <div className="msg ai">
              <div className="msg-avatar">R</div>
              <div className="msg-bubble">
                <div className="typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          ) : null}

          {error ? <div className="error-toast">{error}</div> : null}
        </div>

        <div className="chat-input-bar">
          <span className="chat-hint">
            {!hasDraft ? "▸ your review" : wrappedUp ? "▸ review complete" : "▸ your reply"}
          </span>
          <div className="chat-input">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKey}
              placeholder={
                wrappedUp
                  ? "Thanks — your review is complete."
                  : hasDraft
                    ? "Type your reply…"
                    : "Tell us about your stay — the good, the awkward, what we should know…"
              }
              disabled={wrappedUp || isThinking}
              rows={1}
            />
            <button
              className="chat-send"
              onClick={onSend}
              disabled={!canSend}
              title={sendLabel}
              aria-label={sendLabel}
            >
              ↑
            </button>
          </div>
          <span className="chat-footer-note">
            Press Enter to send · Shift + Enter for a new line
          </span>
        </div>
      </div>

      {/* Sidebar: live property card + updates */}
      <aside className="chat-side">
        <div className="side-kicker">The listing</div>
        <div className="side-property-card">
          <div className="loc">
            {[selected?.city, selected?.country].filter(Boolean).join(" · ") || "—"}
          </div>
          <h3>{selected?.city ?? "Your stay"}</h3>
          <div className="rating">
            <span className="stars">★★★★★</span>
            <span>4.6 · 1,284 reviews</span>
          </div>
          <p className="summary">{selected?.propertySummary}</p>
        </div>

        <div className="side-kicker">What your review adds</div>
        {facts.length === 0 ? (
          <div className="empty-side">
            As you answer, new details you share will update this listing for future travelers.
          </div>
        ) : (
          <div>
            <div className="updates-title">
              <h4>Live updates</h4>
              <span className="count">
                {facts.length} fact{facts.length === 1 ? "" : "s"}
              </span>
            </div>
            {facts.map((fact, i) => (
              <div className="update-item" key={`${fact.factType}-${i}`}>
                <div className="u-label">{fact.factType?.replaceAll("_", " ")}</div>
                <div className="u-value">{formatFactValue(fact.value)}</div>
              </div>
            ))}
          </div>
        )}

        {wrappedUp ? (
          <div className="finish-banner">
            Thank you
            <span className="big">Your review is ready to post.</span>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function formatFactValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return String(v);
  return String(v);
}
