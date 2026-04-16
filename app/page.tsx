"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../convex/_generated/api";
import { appendTranscriptToDraft } from "../src/lib/audio";
import {
  REALTIME_AUDIO_SAMPLE_RATE,
  float32ToPCM16,
  insertOrderedItemId,
  pcm16ToBase64,
} from "../src/lib/realtimeAudio";

/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */

type DemoProperty = {
  propertyId: string;
  city?: string;
  province?: string;
  country?: string;
  starRating?: number;
  guestRating?: number;
  propertySummary: string;
  popularAmenities?: string;
  reviewCount: number;
  vendorReviewCount?: number;
  firstPartyReviewCount?: number;
  liveReviewCount?: number;
  lastRecomputedAt?: string;
  recomputeStatus?: string;
  demoFlags: string[];
  demoScenario?: string;
};

type ChatMessage =
  | {
      id: string;
      role: "ai";
      label?: string;
      text: string;
      kind?: "question" | "intro" | "wrapup" | "preview";
    }
  | { id: string; role: "user"; text: string };

type Fact = {
  id: string;
  facet: string;
  factType: string;
  value: unknown;
  confidence: number;
  source: "draft_review" | "follow_up_answer";
  sourceText: string;
  editable: boolean;
  selected: boolean;
  editedValue: string;
};

type AspectRatings = {
  service?: number;
  cleanliness?: number;
  amenities?: number;
  value?: number;
};

type TripContext = {
  tripType?: string;
  stayLengthBucket?: string;
  arrivalTimeBucket?: string;
  roomType?: string;
};

type NextTurn =
  | {
      turnType: "clarify_review";
      assistantText: string;
      facet: null;
      questionText: null;
      noFollowUp: false;
    }
  | {
      turnType: "facet_followup";
      assistantText: string;
      facet: string;
      questionText: string;
      noFollowUp: false;
    }
  | {
      turnType: "no_follow_up";
      assistantText: string;
      facet: null;
      questionText: null;
      noFollowUp: true;
    };

type View = "grid" | "chat";

type ThinkingPhase =
  | "analyzing"
  | "choosing"
  | "composing"
  | "revising"
  | "saving";

const PHASE_COPY: Record<
  ThinkingPhase,
  { top: string; sub: string[] }
> = {
  analyzing: {
    top: "Analyzing your review",
    sub: [
      "reading your draft",
      "matching against this property",
      "checking what\u2019s under-covered",
    ],
  },
  choosing: {
    top: "Choosing the next question",
    sub: [
      "noting your answer",
      "checking remaining gaps",
      "drafting a follow-up",
    ],
  },
  composing: {
    top: "Composing your review",
    sub: [
      "extracting facts from your answers",
      "drafting the enhanced text",
      "polishing",
    ],
  },
  revising: {
    top: "Revising your review",
    sub: ["applying your notes", "redrafting", "polishing"],
  },
  saving: {
    top: "Saving your review",
    sub: ["filing the facts", "attaching to the property"],
  },
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ═══════════════════════════════════════════════════════
   Root Page
   ═══════════════════════════════════════════════════════ */

export default function HomePage() {
  return (
    <>
      <AuthLoading>
        <LoadingScreen />
      </AuthLoading>
      <Unauthenticated>
        <HeroLanding />
      </Unauthenticated>
      <Authenticated>
        <AuthenticatedApp />
      </Authenticated>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   Nav
   ═══════════════════════════════════════════════════════ */

function Nav({ showUser }: { showUser?: boolean }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <nav className="nav">
      <div className="nav-brand">
        <span className="mark">R</span>
        <div>
          <div className="title">ReviewGap</div>
          <div className="subtitle">The Traveler&rsquo;s Dispatch</div>
        </div>
      </div>
      <div className="nav-meta">
        <span>{today}</span>
        <span className="dot" />
        <span>Vol.&nbsp;I · No.&nbsp;13</span>
        <span className="dot" />
        <span>Field Edition</span>
      </div>
      <div className="nav-actions">
        {showUser && <UserButton />}
      </div>
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════
   Loading
   ═══════════════════════════════════════════════════════ */

function LoadingScreen() {
  return (
    <div className="loading-page">
      <div className="compass" aria-hidden="true">
        <span className="compass-ring" />
        <span className="compass-needle" />
        <span className="compass-n">N</span>
      </div>
      <p className="loading-kicker">Reading the register</p>
      <p className="loading-dek">
        Verifying your credentials<span className="loading-dots"><span/><span/><span/></span>
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Hero Landing (Unauthenticated)
   ═══════════════════════════════════════════════════════ */

const HERO_IMAGES = [
  { slug: "photo-1566073771259-6a8506099945", place: "Frisco · Texas" },
  { slug: "photo-1542314831-068cd1dbfeeb", place: "Madrid · Spain" },
  { slug: "photo-1590490360182-c33d57733427", place: "Amalfi · Italy" },
  { slug: "photo-1535827841776-24afc1e255ac", place: "Kyoto · Japan" },
];

function HeroLanding() {
  const [activeImage, setActiveImage] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setActiveImage((n) => (n + 1) % HERO_IMAGES.length);
    }, 4400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="eh">
      <header className="eh-bar">
        <div className="eh-bar-brand">
          <span className="eh-bar-mark">R</span>
          <span className="eh-bar-word">ReviewGap</span>
        </div>
        <SignInButton mode="modal">
          <button className="eh-bar-signin" type="button">
            Sign in <span className="arr">→</span>
          </button>
        </SignInButton>
      </header>

      <div className="eh-split">
        <div className="eh-col-lead">
          <div className="eh-kicker">The Traveler&rsquo;s Dispatch</div>
          <h1 className="eh-headline">
            Every stay
            <br />
            tells a <em>story.</em>
            <br />
            <span className="muted">We help you</span>
            <br />
            <span className="muted">write it</span> well.
          </h1>
          <p className="eh-dek">
            ReviewGap asks the quiet questions other travelers wish you&rsquo;d
            answered — filling the gaps until your review becomes a small,
            useful field report for whoever books the room next.
          </p>
          <div className="eh-actions">
            <SignInButton mode="modal">
              <button className="eh-btn" type="button">
                Begin your dispatch
                <span className="btn-arrow">→</span>
              </button>
            </SignInButton>
            <div className="eh-counter">
              <span className="counter-num">13</span>
              <span className="counter-label">
                destinations
                <br />
                in rotation
              </span>
            </div>
          </div>
        </div>

        <div className="eh-col-photo">
          <div className="eh-photo-frame">
            {HERO_IMAGES.map((img, i) => (
              <img
                key={img.slug}
                src={`https://images.unsplash.com/${img.slug}?auto=format&fit=crop&w=1400&q=82`}
                alt={img.place}
                className={`eh-photo${i === activeImage ? " active" : ""}`}
              />
            ))}
            <div className="eh-photo-caption">
              <span className="caption-dot" />
              <span className="caption-key">Now reading</span>
              <span className="caption-place">
                {HERO_IMAGES[activeImage].place}
              </span>
            </div>
            <div className="eh-photo-pager">
              {HERO_IMAGES.map((_, i) => (
                <span
                  key={i}
                  className={`pg${i === activeImage ? " active" : ""}`}
                  aria-hidden="true"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   Authenticated App Shell
   ═══════════════════════════════════════════════════════ */

function AuthenticatedApp() {
  const properties = useQuery(api.reviewGapPublic.listDemoProperties, {}) as DemoProperty[] | undefined;
  const createReviewSession = useMutation(api.reviewGapPublic.createReviewSession);
  const selectNextQuestion = useAction(api.reviewGapActions.selectNextQuestion);
  const updateStructuredReview = useAction(api.reviewGapActions.updateStructuredReview);
  const submitFollowUpAnswer = useAction(api.reviewGapActions.submitFollowUpAnswer);
  const finalizeReviewPreview = useAction(api.reviewGapActions.finalizeReviewPreview);
  const confirmEnhancedReview = useAction(api.reviewGapActions.confirmEnhancedReview);

  const [view, setView] = useState<View>("grid");
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [detailPropertyId, setDetailPropertyId] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFacet, setPendingFacet] = useState<string | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [tripContext, setTripContext] = useState<TripContext | null>(null);
  const [wrappedUp, setWrappedUp] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [reviewDraft, setReviewDraft] = useState("");
  const [followUpCount, setFollowUpCount] = useState(0);
  const [askedFacets, setAskedFacets] = useState<string[]>([]);
  const [answerHistory, setAnswerHistory] = useState<string[]>([]);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [previewReviewText, setPreviewReviewText] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState<string[]>([]);
  const [thinkingPhase, setThinkingPhase] = useState<ThinkingPhase | null>(null);
  const [overallRating, setOverallRating] = useState<number | null>(null);
  const [aspectRatings, setAspectRatings] = useState<AspectRatings>({});
  const [needsStructuredReview, setNeedsStructuredReview] = useState(false);
  const [queuedNextTurn, setQueuedNextTurn] = useState<NextTurn | null>(null);

  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }, [draft, view]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, isThinking]);

  const selectedProperty = useMemo(
    () => properties?.find((p) => p.propertyId === selectedPropertyId) ?? null,
    [properties, selectedPropertyId],
  );

  const selectedPropertyImageUrl = useMemo(() => {
    if (!selectedPropertyId || !properties) return null;
    const idx = properties.findIndex((p) => p.propertyId === selectedPropertyId);
    if (idx < 0) return null;
    const slug = CARD_IMAGE_POOL[idx % CARD_IMAGE_POOL.length];
    return `https://images.unsplash.com/${slug}?auto=format&fit=crop&w=900&q=82`;
  }, [properties, selectedPropertyId]);

  function startReview(prop: DemoProperty) {
    setSelectedPropertyId(prop.propertyId);
    setView("chat");
    setSessionId(null);
    setDraft("");
    setPendingFacet(null);
    setFacts([]);
    setTripContext(null);
    setWrappedUp(false);
    setHasDraft(false);
    setReviewDraft("");
    setFollowUpCount(0);
    setAskedFacets([]);
    setAnswerHistory([]);
    setAwaitingConfirmation(false);
    setPreviewReviewText(null);
    setRevisionNotes([]);
    setError(null);
    setOverallRating(null);
    setAspectRatings({});
    setNeedsStructuredReview(true);
    setQueuedNextTurn(null);
    setMessages([
      {
        id: uid(),
        role: "ai",
        kind: "intro",
        text: `Start with a quick rating for your stay at ${prop.city ?? "the property"}, then tell me about it in your own words. I’ll ask a couple of follow-ups and draft the final review for you to approve.`,
      },
    ]);
  }

  function backToGrid() {
    setView("grid");
    setTripContext(null);
  }

  async function sendUserMessage() {
    const trimmed = draft.trim();
    if (!trimmed || isThinking) return;

    setMessages((prev) => [...prev, { id: uid(), role: "user", text: trimmed }]);
    setDraft("");

    if (awaitingConfirmation) {
      await handleConfirmationReply(trimmed);
      return;
    }

    if (needsStructuredReview) {
      setError("Add an overall rating to continue.");
      return;
    }

    if (pendingFacet) {
      await submitAnswer(trimmed, reviewDraft);
      return;
    }

    const nextReviewDraft = [reviewDraft, trimmed].filter(Boolean).join(" ").trim();
    setHasDraft(true);
    setReviewDraft(nextReviewDraft);
    await advanceConversation(nextReviewDraft);
  }

  async function advanceConversation(draftReview: string) {
    if (!selectedPropertyId) return;
    setIsThinking(true);
    setThinkingPhase("analyzing");
    setError(null);

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const session = await createReviewSession({ propertyId: selectedPropertyId, draftReview });
        activeSessionId = session.sessionId;
        setSessionId(session.sessionId);
      }
      const next = (await selectNextQuestion({
        sessionId: activeSessionId,
        draftReview,
      })) as NextTurn;
      await handleNextTurn(activeSessionId, draftReview, next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsThinking(false);
      setThinkingPhase(null);
    }
  }

  async function handleNextTurn(activeSessionId: string, draftReview: string, next: NextTurn) {
    if (!overallRating && next.turnType !== "clarify_review") {
      setNeedsStructuredReview(true);
      setQueuedNextTurn(next);
      return;
    }

    if (next.turnType === "no_follow_up" || next.noFollowUp) {
      setPendingFacet(null);
      setThinkingPhase("composing");
      await createFinalPreview(activeSessionId, draftReview, []);
      return;
    }

    if (next.turnType === "clarify_review") {
      setPendingFacet(null);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "ai",
          kind: "question",
          text: next.assistantText,
        },
      ]);
      return;
    }

    const facet = next.facet;
    setPendingFacet(facet);
    setFollowUpCount((n) => n + 1);
    setAskedFacets((prev) => [...prev, facet]);
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: "ai",
        kind: "question",
        label: facet.replaceAll("_", " "),
        text: next.questionText,
      },
    ]);
  }

  async function continueAfterStructuredReview() {
    if (!selectedPropertyId || !overallRating) return;
    setIsThinking(true);
    setThinkingPhase(sessionId ? "choosing" : "analyzing");
    setError(null);
    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const session = await createReviewSession({
          propertyId: selectedPropertyId,
          draftReview: reviewDraft || undefined,
        });
        activeSessionId = session.sessionId;
        setSessionId(session.sessionId);
      }

      await updateStructuredReview({
        sessionId: activeSessionId,
        overallRating,
        aspectRatings: Object.keys(aspectRatings).length > 0 ? aspectRatings : undefined,
      });
      setNeedsStructuredReview(false);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "user",
          text: buildRatingSummary(overallRating, aspectRatings),
        },
      ]);

      if (!hasDraft) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "ai",
            kind: "question",
            text: "Got it. Now tell me what drove that score, especially what stood out about the stay.",
          },
        ]);
        return;
      }

      const nextTurn = queuedNextTurn;
      setQueuedNextTurn(null);
      if (nextTurn) {
        await handleNextTurn(activeSessionId, reviewDraft, nextTurn);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t save your rating.");
    } finally {
      setIsThinking(false);
      setThinkingPhase(null);
    }
  }

  async function submitAnswer(answerText: string, activeReviewDraft: string) {
    if (!sessionId || !pendingFacet) return;
    setIsThinking(true);
    setThinkingPhase("choosing");
    setError(null);

    try {
      const currentFacet = pendingFacet;
      await submitFollowUpAnswer({
        sessionId,
        facet: currentFacet,
        answerText,
      });
      const nextAnswerHistory = [...answerHistory, answerText];
      setAnswerHistory(nextAnswerHistory);

      const keepGoing = followUpCount < 2;
      if (keepGoing && sessionId) {
        try {
          const conversationDraft = [activeReviewDraft, ...nextAnswerHistory].join(" ").trim();
          const next = (await selectNextQuestion({
            sessionId,
            draftReview: conversationDraft,
          })) as NextTurn;

          if (
            next.turnType === "facet_followup" &&
            next.facet !== currentFacet &&
            !askedFacets.includes(next.facet)
          ) {
            await handleNextTurn(sessionId, activeReviewDraft, next);
            return;
          }
        } catch {
          // fall through to wrap-up
        }
      }
      setPendingFacet(null);
      setThinkingPhase("composing");
      await createFinalPreview(sessionId, activeReviewDraft, revisionNotes);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn\u2019t save your answer.");
    } finally {
      setIsThinking(false);
      setThinkingPhase(null);
    }
  }

  async function createFinalPreview(
    activeSessionId: string,
    draftReview: string,
    notes: string[],
  ) {
    const preview = await finalizeReviewPreview({
      sessionId: activeSessionId,
      draftReview,
      revisionNotes: notes.length > 0 ? notes : undefined,
    });

    setFacts(
      preview.factCandidates.map((fact) => ({
        id: fact.id,
        facet: fact.facet,
        factType: fact.factType,
        value: fact.value,
        confidence: fact.confidence,
        source: fact.source,
        sourceText: fact.sourceText,
        editable: fact.editable,
        selected: fact.selectedByDefault,
        editedValue: formatFactValue(fact.value),
      })),
    );
    setTripContext(preview.tripContext ?? null);
    setPreviewReviewText(preview.reviewText);
    setAwaitingConfirmation(true);
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: "ai",
        kind: "preview",
        label: "Draft review",
        text: preview.reviewText,
      },
      {
        id: uid(),
        role: "ai",
        kind: "wrapup",
        text: preview.confirmationPrompt,
      },
    ]);
  }

  async function handleConfirmationReply(replyText: string) {
    if (!sessionId || !previewReviewText) return;
    const normalized = replyText.trim().toLowerCase();
    const approved = /^(yes|yep|yeah|looks good|looks right|accurate|save it|publish it|works)$/.test(
      normalized,
    );

    setIsThinking(true);
    setThinkingPhase(approved ? "saving" : "revising");
    setError(null);

    try {
      if (approved) {
        await confirmEnhancedReview({
          sessionId,
          finalReviewText: previewReviewText,
          factCandidates: facts.map((fact) => ({
            id: fact.id,
            facet: String((fact as { facet?: string }).facet ?? ""),
            factType: fact.factType,
            value: fact.value as string | number | boolean,
            confidence: Number((fact as { confidence?: number }).confidence ?? 0.5),
            source: fact.source,
            sourceText: fact.sourceText,
            editable: fact.editable,
            selectedByDefault: fact.selected,
          })),
          confirmedFactIds: facts.filter((fact) => fact.selected).map((fact) => fact.id),
          editedFacts: facts
            .filter((fact) => fact.selected && fact.editedValue.trim() !== formatFactValue(fact.value))
            .map((fact) => ({
              id: fact.id,
              value: coerceFactInputValue(fact.value, fact.editedValue),
            })),
        });
        setAwaitingConfirmation(false);
        setWrappedUp(true);
        setPendingFacet(null);
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "ai",
            kind: "wrapup",
            text: "Saved. This enhanced review is now attached to the property and will appear at the top of the review list.",
          },
        ]);
        return;
      }

      const nextRevisionNotes = [...revisionNotes, replyText];
      setRevisionNotes(nextRevisionNotes);
      await createFinalPreview(sessionId, reviewDraft, nextRevisionNotes);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t finalize the review.");
    } finally {
      setIsThinking(false);
      setThinkingPhase(null);
    }
  }

  function toggleFactSelection(id: string) {
    setFacts((prev) =>
      prev.map((fact) =>
        fact.id === id ? { ...fact, selected: !fact.selected } : fact,
      ),
    );
  }

  function updateFactValue(id: string, editedValue: string) {
    setFacts((prev) =>
      prev.map((fact) =>
        fact.id === id ? { ...fact, editedValue } : fact,
      ),
    );
  }

  function onTextareaKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendUserMessage();
    }
  }

  const canSend = draft.trim().length > 0 && !isThinking && !wrappedUp && !needsStructuredReview;
  const sendLabel = !hasDraft ? "send review" : awaitingConfirmation ? "confirm" : pendingFacet ? "reply" : "send";

  return (
    <>
      <Nav showUser />
      {view === "grid" ? (
        <div className="page">
          <PropertyGrid
            properties={properties ?? []}
            onStartReview={startReview}
            onViewDetail={setDetailPropertyId}
          />
          {detailPropertyId && (
            <PropertyDetail
              propertyId={detailPropertyId}
              imageIndex={
                properties?.findIndex((p) => p.propertyId === detailPropertyId) ?? 0
              }
              onClose={() => setDetailPropertyId(null)}
              onStartReview={() => {
                const prop = properties?.find((p) => p.propertyId === detailPropertyId);
                if (prop) {
                  setDetailPropertyId(null);
                  startReview(prop);
                }
              }}
            />
          )}
        </div>
      ) : (
        <ChatView
          property={selectedProperty}
          propertyImageUrl={selectedPropertyImageUrl}
          messages={messages}
          isThinking={isThinking}
          thinkingPhase={thinkingPhase}
          onApproveReview={() => void handleConfirmationReply("yes")}
          draft={draft}
          onDraftChange={setDraft}
          onSend={sendUserMessage}
          onBack={backToGrid}
          onKey={onTextareaKey}
          canSend={canSend}
          sendLabel={sendLabel}
          facts={facts}
          tripContext={tripContext}
          onToggleFactSelection={toggleFactSelection}
          onFactValueChange={updateFactValue}
          overallRating={overallRating}
          aspectRatings={aspectRatings}
          needsStructuredReview={needsStructuredReview}
          onOverallRatingChange={setOverallRating}
          onAspectRatingChange={(key, value) =>
            setAspectRatings((prev) => ({ ...prev, [key]: value }))
          }
          onStructuredContinue={continueAfterStructuredReview}
          wrappedUp={wrappedUp}
          hasDraft={hasDraft}
          awaitingConfirmation={awaitingConfirmation}
          chatBodyRef={chatBodyRef}
          textareaRef={textareaRef}
          error={error}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   Property Grid
   ═══════════════════════════════════════════════════════ */

function PropertyGrid({
  properties,
  onStartReview,
  onViewDetail,
}: {
  properties: DemoProperty[];
  onStartReview: (p: DemoProperty) => void;
  onViewDetail: (id: string) => void;
}) {
  if (properties.length === 0) {
    return (
      <div className="loading-page" style={{ minHeight: "50vh" }}>
        <div className="compass small" aria-hidden="true">
          <span className="compass-ring" />
          <span className="compass-needle" />
          <span className="compass-n">N</span>
        </div>
        <p className="loading-kicker">The field guide</p>
        <p className="loading-dek">Gathering the properties<span className="loading-dots"><span/><span/><span/></span></p>
      </div>
    );
  }

  return (
    <>
      <div className="section-header">
        <h2>
          The <em>field guide</em>
        </h2>
        <div className="meta">{properties.length} properties</div>
      </div>
      <div className="property-grid">
        {properties.map((p, i) => (
          <PropertyCard
            key={p.propertyId}
            property={p}
            index={i}
            featured={i === 0}
            onStartReview={() => onStartReview(p)}
            onViewDetail={() => onViewDetail(p.propertyId)}
          />
        ))}
      </div>
    </>
  );
}

const CARD_IMAGE_POOL = [
  "photo-1566073771259-6a8506099945", // hotel pool
  "photo-1564501049412-61c2a3083791", // resort
  "photo-1542314831-068cd1dbfeeb", // beach villa
  "photo-1571003123894-1f0594d2b5d9", // suite
  "photo-1445019980597-93fa8acb246c", // lobby
  "photo-1611892440504-42a792e24d32", // hotel room
  "photo-1551882547-ff40c63fe5fa", // bedroom
  "photo-1520250497591-112f2f40a3f4", // bath
  "photo-1590490360182-c33d57733427", // cliff hotel
  "photo-1535827841776-24afc1e255ac", // modern hotel
  "photo-1455587734955-081b22074882", // cityscape room
  "photo-1582719508461-905c673771fd", // pool deck
  "photo-1549294413-26f195200c16", // mountain lodge
];

function hashIndex(id: string, mod: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function PropertyCard({
  property: p,
  index,
  featured,
  onStartReview,
  onViewDetail,
}: {
  property: DemoProperty;
  index: number;
  featured?: boolean;
  onStartReview: () => void;
  onViewDetail: () => void;
}) {
  const rating = typeof p.guestRating === "number" ? p.guestRating.toFixed(1) : null;
  const location = [p.city, p.province, p.country].filter(Boolean).join(" · ");
  const amenities = p.popularAmenities
    ?.split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3) ?? [];

  const imageUrl = `https://images.unsplash.com/${
    CARD_IMAGE_POOL[index % CARD_IMAGE_POOL.length]
  }?auto=format&fit=crop&w=900&q=80`;
  void featured;
  void amenities;

  const ratingWord = (() => {
    if (!rating) return null;
    const n = Number(rating);
    if (n >= 9) return "Wonderful";
    if (n >= 8) return "Very good";
    if (n >= 7) return "Good";
    return "Okay";
  })();
  const recomputeLabel =
    p.recomputeStatus === "ready"
      ? p.lastRecomputedAt
        ? `recomputed ${formatShortDate(p.lastRecomputedAt)}`
        : "recomputed"
      : p.recomputeStatus === "recomputing"
        ? "recomputing"
        : null;

  return (
    <div className="prop-card" onClick={onViewDetail}>
      <div className="card-plate">
        <img src={imageUrl} alt={p.city ?? "Property"} loading="lazy" />
        {rating && (
          <span className="card-rating-badge">{rating}</span>
        )}
      </div>
      <div className="card-body">
        <div className="card-location">{location || "—"}</div>
        <h3>
          <em>{p.city ?? "The Property"}</em>
        </h3>
        {ratingWord && (
          <div className="card-rating-row">
            <span className="rating-word">{ratingWord}</span>
            <span className="rating-count">
              · {p.reviewCount} review{p.reviewCount === 1 ? "" : "s"}
            </span>
          </div>
        )}
        {recomputeLabel && (
          <div className="card-location">
            {recomputeLabel}
            {typeof p.firstPartyReviewCount === "number" && p.firstPartyReviewCount > 0
              ? ` · ${p.firstPartyReviewCount} traveler`
              : ""}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Property Detail (Modal Overlay)
   ═══════════════════════════════════════════════════════ */

function PropertyDetail({
  propertyId,
  imageIndex,
  onClose,
  onStartReview,
}: {
  propertyId: string;
  imageIndex: number;
  onClose: () => void;
  onStartReview: () => void;
}) {
  const detail = useQuery(api.reviewGapPublic.getPropertyDetail, { propertyId });
  const reviewsData = useQuery(api.reviewGapPublic.listPropertyReviews, { propertyId });

  if (!detail) {
    return (
      <div className="detail-overlay" onClick={onClose}>
        <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
          <div className="loading-page" style={{ minHeight: 320 }}>
            <div className="compass small" aria-hidden="true">
              <span className="compass-ring" />
              <span className="compass-needle" />
              <span className="compass-n">N</span>
            </div>
            <p className="loading-kicker">The folio</p>
            <p className="loading-dek">Unfolding the dispatch<span className="loading-dots"><span/><span/><span/></span></p>
          </div>
        </div>
      </div>
    );
  }

  const rating = typeof detail.guestRating === "number" ? detail.guestRating.toFixed(1) : null;
  const location = [detail.city, detail.province, detail.country].filter(Boolean).join(" · ");
  const allReviews = reviewsData?.reviews ?? [];
  const reviews = allReviews.filter((r: { text: string }) => r.text && r.text.trim().length > 0);
  const counts = reviewsData?.counts;

  const imageUrl = `https://images.unsplash.com/${
    CARD_IMAGE_POOL[((imageIndex % CARD_IMAGE_POOL.length) + CARD_IMAGE_POOL.length) % CARD_IMAGE_POOL.length]
  }?auto=format&fit=crop&w=1600&q=82`;

  const ratingWord = (() => {
    if (!rating) return null;
    const n = Number(rating);
    if (n >= 9) return "Wonderful";
    if (n >= 8) return "Very good";
    if (n >= 7) return "Good";
    return "Okay";
  })();

  const topAmenities = (() => {
    const all: string[] = [];
    for (const g of detail.amenityGroups ?? []) {
      for (const item of g.items) {
        if (!all.includes(item)) all.push(item);
        if (all.length >= 6) break;
      }
      if (all.length >= 6) break;
    }
    return all;
  })();

  const displayedReviews = reviews.slice(0, 6);

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button
          className="detail-close"
          type="button"
          onClick={onClose}
          aria-label="Close"
        >
          {"\u00d7"}
        </button>

        {/* Striking hero — image with overlay typography */}
        <div className="detail-hero">
          <img src={imageUrl} alt={detail.city ?? "Property"} />
          <div className="dh-overlay">
            <div className="dh-location">{location || "—"}</div>
            <h2>
              <em>{detail.city ?? "The Property"}</em>
            </h2>
            {rating && (
              <div className="dh-rating-row">
                <span className="rating-figure">{rating}</span>
                <span className="rating-slash">/ 10</span>
                <span className="rating-word">{ratingWord}</span>
                <span className="rating-count">
                  {counts?.total ?? 0} review{counts?.total === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Floating CTA tucked under the hero */}
        <div className="dh-actions">
          <button
            className="dh-cta"
            type="button"
            onClick={onStartReview}
          >
            Write a review
            <span className="cta-arrow">→</span>
          </button>
        </div>

        <div className="detail-body">
          {detail.propertySummary && (
            <section className="detail-section">
              <h3>About <em>the stay</em></h3>
              <p className="detail-prose">{detail.propertySummary}</p>
            </section>
          )}

          {topAmenities.length > 0 && (
            <section className="detail-section">
              <h3>Popular <em>amenities</em></h3>
              <ul className="amenity-flat">
                {topAmenities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {displayedReviews.length > 0 && (
            <section className="detail-section">
              <h3>
                Reviews
                {counts && (
                  <span className="review-count">&nbsp;·&nbsp;{counts.total}</span>
                )}
              </h3>
              <div className="reviews-list">
                {displayedReviews.map((r: {
                  id: string;
                  kind: string;
                  title: string;
                  text: string;
                  rating: number | null;
                  reviewDate: string;
                  factCount: number;
                  sentiment: string | null;
                }) => {
                  const isEnhanced = r.kind === "traveler";
                  return (
                    <article
                      className={`review-item${isEnhanced ? " enhanced" : ""}`}
                      key={r.id}
                    >
                      <div className="review-meta">
                        {isEnhanced && (
                          <span className="review-tag">
                            <span className="tag-dot" aria-hidden="true" />
                            Enhanced
                            {r.factCount > 0 && (
                              <span className="tag-count">
                                · {r.factCount} fact{r.factCount === 1 ? "" : "s"}
                              </span>
                            )}
                          </span>
                        )}
                        {typeof r.rating === "number" && (
                          <span className="review-date">
                            {r.rating.toFixed(1)} / 10
                          </span>
                        )}
                        <span className="review-date">
                          {r.reviewDate
                            ? new Date(r.reviewDate).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : ""}
                        </span>
                      </div>
                      <p className="review-text">
                        <span className="review-quote" aria-hidden="true">&ldquo;</span>
                        {r.text}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Chat View
   ═══════════════════════════════════════════════════════ */

function WorkingBlock({ phase }: { phase: ThinkingPhase }) {
  const copy = PHASE_COPY[phase];
  const [visible, setVisible] = useState(false);
  const [subIndex, setSubIndex] = useState(0);

  useEffect(() => {
    setVisible(false);
    setSubIndex(0);
    const show = window.setTimeout(() => setVisible(true), 350);
    return () => window.clearTimeout(show);
  }, [phase]);

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => {
      setSubIndex((n) => (n + 1) % copy.sub.length);
    }, 1400);
    return () => window.clearInterval(id);
  }, [visible, copy.sub.length]);

  if (!visible) return null;

  return (
    <div className="iv-working" role="status" aria-live="polite">
      <div className="iv-working-row">
        <span className="iv-working-pip" aria-hidden="true" />
        <span className="iv-working-kicker">Working</span>
      </div>
      <div className="iv-working-top">{copy.top}</div>
      <div className="iv-working-sub" key={subIndex}>
        {copy.sub[subIndex]}
      </div>
    </div>
  );
}

function OverallLadder({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;

  const word = (() => {
    if (display === null || display === undefined) return "Tap a number";
    if (display >= 9) return "Wonderful";
    if (display >= 8) return "Very good";
    if (display >= 7) return "Good";
    if (display >= 5) return "Fair";
    return "Disappointing";
  })();

  return (
    <div className="sr-overall">
      <div className="sr-overall-display">
        <div className="sr-overall-numeral">
          {display !== null && display !== undefined ? (
            <em>{display}</em>
          ) : (
            <span className="sr-overall-empty">—</span>
          )}
          <span className="sr-overall-slash">/&nbsp;10</span>
        </div>
        <div className="sr-overall-word">{word}</div>
      </div>
      <div
        className="sr-tiles"
        onMouseLeave={() => setHover(null)}
        role="radiogroup"
        aria-label="Overall rating"
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const isSelected = value === n;
          const isHover = hover === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`sr-tile${isSelected ? " selected" : ""}${isHover ? " hover" : ""}`}
              onClick={() => onChange(n)}
              onMouseEnter={() => setHover(n)}
              aria-label={`Rate ${n} out of 10`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PipRow({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <div className="sr-mini" role="radiogroup">
      {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => {
        const isSelected = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={`sr-mini-tile${isSelected ? " selected" : ""}`}
            onClick={() => onChange(n)}
            aria-label={`Rate ${n} out of 5`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function StructuredReviewCard({
  overallRating,
  aspectRatings,
  onOverallRatingChange,
  onAspectRatingChange,
  onContinue,
  disabled,
}: {
  overallRating: number | null;
  aspectRatings: AspectRatings;
  onOverallRatingChange: (value: number) => void;
  onAspectRatingChange: (key: keyof AspectRatings, value: number) => void;
  onContinue: () => void;
  disabled: boolean;
}) {
  const aspects: Array<[keyof AspectRatings, string]> = [
    ["service", "Service"],
    ["cleanliness", "Cleanliness"],
    ["amenities", "Amenities"],
    ["value", "Value"],
  ];
  return (
    <div className="iv-structured">
      <div className="sr-head">
        <div className="sr-kicker">Before we begin</div>
        <div className="sr-title">
          Rate <em>your stay</em>
        </div>
        <div className="sr-copy">
          Overall is required. Aspects are optional &mdash; they help us frame the follow-ups.
        </div>
      </div>

      <div className="sr-overall-wrap">
        <div className="sr-field-label">Overall</div>
        <OverallLadder value={overallRating} onChange={onOverallRatingChange} />
      </div>

      <div className="sr-aspects">
        {aspects.map(([key, label]) => (
          <div className="sr-aspect" key={key}>
            <div className="sr-aspect-label">
              <span>{label}</span>
              <span className="sr-aspect-val">
                {aspectRatings[key] ? `${aspectRatings[key]} / 5` : ""}
              </span>
            </div>
            <PipRow
              value={aspectRatings[key]}
              onChange={(value) => onAspectRatingChange(key, value)}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        className="sr-continue"
        disabled={disabled || !overallRating}
        onClick={onContinue}
      >
        Continue
        <span className="sr-arrow">&rarr;</span>
      </button>
    </div>
  );
}

function ChatView({
  property,
  propertyImageUrl,
  messages,
  isThinking,
  thinkingPhase,
  onApproveReview,
  draft,
  onDraftChange,
  onSend,
  onBack,
  onKey,
  canSend,
  sendLabel,
  facts,
  tripContext,
  onToggleFactSelection,
  onFactValueChange,
  overallRating,
  aspectRatings,
  needsStructuredReview,
  onOverallRatingChange,
  onAspectRatingChange,
  onStructuredContinue,
  wrappedUp,
  hasDraft,
  awaitingConfirmation,
  chatBodyRef,
  textareaRef,
  error,
}: {
  property: DemoProperty | null;
  propertyImageUrl: string | null;
  messages: ChatMessage[];
  isThinking: boolean;
  thinkingPhase: ThinkingPhase | null;
  onApproveReview: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onBack: () => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  canSend: boolean;
  sendLabel: string;
  facts: Fact[];
  tripContext: TripContext | null;
  onToggleFactSelection: (id: string) => void;
  onFactValueChange: (id: string, value: string) => void;
  overallRating: number | null;
  aspectRatings: AspectRatings;
  needsStructuredReview: boolean;
  onOverallRatingChange: (value: number) => void;
  onAspectRatingChange: (key: keyof AspectRatings, value: number) => void;
  onStructuredContinue: () => void;
  wrappedUp: boolean;
  hasDraft: boolean;
  awaitingConfirmation: boolean;
  chatBodyRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  error: string | null;
}) {
  const ratingLabel =
    typeof property?.guestRating === "number" ? property.guestRating.toFixed(1) : "\u2014";
  const reviewCount = property?.reviewCount ?? 0;
  const recomputeMeta =
    property?.recomputeStatus === "ready"
      ? property.lastRecomputedAt
        ? `Recomputed ${formatShortDate(property.lastRecomputedAt)}`
        : "Recomputed"
      : property?.recomputeStatus === "recomputing"
        ? "Recomputing now"
        : "Awaiting recompute";

  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptBaseDraftRef = useRef("");
  const transcriptOrderRef = useRef<string[]>([]);
  const transcriptByItemIdRef = useRef(new Map<string, string>());
  const pendingAudioMsRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const finalizeTimerRef = useRef<number | null>(null);
  const [audioStatus, setAudioStatus] = useState<"idle" | "connecting" | "recording" | "finishing">("idle");
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (finalizeTimerRef.current !== null) window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
      processorNodeRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioContextRef.current) void audioContextRef.current.close().catch(() => undefined);
      if (realtimeSocketRef.current) {
        realtimeSocketRef.current.onopen = null;
        realtimeSocketRef.current.onmessage = null;
        realtimeSocketRef.current.onerror = null;
        realtimeSocketRef.current.onclose = null;
        realtimeSocketRef.current.close();
      }
    };
  }, []);

  function clearFinalizeTimer() {
    if (finalizeTimerRef.current !== null) window.clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = null;
  }

  function stopAudioCapture() {
    processorNodeRef.current?.disconnect();
    processorNodeRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  function teardownRealtimeStream(nextStatus: "idle" | "connecting" | "recording" | "finishing" = "idle") {
    clearFinalizeTimer();
    stopAudioCapture();
    const socket = realtimeSocketRef.current;
    realtimeSocketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
    }
    stopRequestedRef.current = false;
    pendingAudioMsRef.current = 0;
    setAudioStatus(nextStatus);
  }

  function refreshDraftFromTranscriptState() {
    const transcript = transcriptOrderRef.current
      .map((itemId) => transcriptByItemIdRef.current.get(itemId)?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    onDraftChange(appendTranscriptToDraft(transcriptBaseDraftRef.current, transcript));
  }

  function ensureTranscriptItem(itemId: string, previousItemId?: string | null) {
    const existing = transcriptOrderRef.current;
    const fallback = previousItemId === undefined ? (existing.at(-1) ?? null) : previousItemId;
    transcriptOrderRef.current = insertOrderedItemId(existing, itemId, fallback);
  }

  function scheduleFinalize(delayMs = 1200) {
    clearFinalizeTimer();
    finalizeTimerRef.current = window.setTimeout(() => {
      teardownRealtimeStream("idle");
      textareaRef.current?.focus();
    }, delayMs);
  }

  async function startLiveTranscription() {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      setAudioError("Live voice transcription isn\u2019t available in this browser.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioError("Microphone access isn\u2019t available in this browser.");
      return;
    }
    setAudioError(null);
    setAudioStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      transcriptBaseDraftRef.current = textareaRef.current?.value ?? draft;
      transcriptOrderRef.current = [];
      transcriptByItemIdRef.current = new Map();
      pendingAudioMsRef.current = 0;
      stopRequestedRef.current = false;
      clearFinalizeTimer();

      const response = await fetch("/api/realtime-session", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { clientSecret?: string; model?: string; error?: string }
        | null;
      if (!response.ok || !payload?.clientSecret || !payload.model) {
        throw new Error(payload?.error ?? "Couldn\u2019t start a live transcription session.");
      }

      const socket = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(payload.model)}`,
        ["realtime", `openai-insecure-api-key.${payload.clientSecret}`],
      );
      realtimeSocketRef.current = socket;

      socket.onopen = async () => {
        try {
          const AudioContextCtor =
            window.AudioContext ||
            (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextCtor) throw new Error("This browser can\u2019t create a live audio stream.");
          const audioContext = new AudioContextCtor({ sampleRate: REALTIME_AUDIO_SAMPLE_RATE });
          audioContextRef.current = audioContext;
          if (audioContext.state === "suspended") await audioContext.resume();
          const sourceNode = audioContext.createMediaStreamSource(stream);
          const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
          processorNode.onaudioprocess = (audioEvent) => {
            const liveSocket = realtimeSocketRef.current;
            if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN || stopRequestedRef.current) return;
            const samples = audioEvent.inputBuffer.getChannelData(0);
            const pcm = float32ToPCM16(samples, audioContext.sampleRate);
            if (pcm.length === 0) return;
            pendingAudioMsRef.current += (pcm.length / REALTIME_AUDIO_SAMPLE_RATE) * 1000;
            liveSocket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm16ToBase64(pcm) }));
          };
          sourceNode.connect(processorNode);
          processorNode.connect(audioContext.destination);
          sourceNodeRef.current = sourceNode;
          processorNodeRef.current = processorNode;
          setAudioStatus("recording");
        } catch (caught) {
          setAudioError(caught instanceof Error ? caught.message : "Couldn\u2019t start live voice transcription.");
          teardownRealtimeStream("idle");
        }
      };

      socket.onmessage = (messageEvent) => {
        const p = JSON.parse(messageEvent.data) as {
          type?: string; item_id?: string; previous_item_id?: string | null;
          delta?: string; transcript?: string; error?: { message?: string };
        };
        const itemId = p.item_id;
        if (p.type === "input_audio_buffer.committed" && itemId) {
          pendingAudioMsRef.current = 0;
          ensureTranscriptItem(itemId, p.previous_item_id);
          if (stopRequestedRef.current) scheduleFinalize();
          return;
        }
        if (p.type === "conversation.item.input_audio_transcription.delta" && itemId) {
          ensureTranscriptItem(itemId);
          transcriptByItemIdRef.current.set(itemId, (transcriptByItemIdRef.current.get(itemId) ?? "") + (p.delta ?? ""));
          refreshDraftFromTranscriptState();
          if (stopRequestedRef.current) scheduleFinalize();
          return;
        }
        if (p.type === "conversation.item.input_audio_transcription.completed" && itemId) {
          ensureTranscriptItem(itemId);
          transcriptByItemIdRef.current.set(itemId, p.transcript ?? "");
          refreshDraftFromTranscriptState();
          if (stopRequestedRef.current) scheduleFinalize();
          return;
        }
        if (p.type === "conversation.item.input_audio_transcription.failed") {
          const message = p.error?.message ?? "Live transcription failed.";
          if (stopRequestedRef.current && message.includes("buffer too small")) { scheduleFinalize(200); return; }
          setAudioError(message);
          teardownRealtimeStream("idle");
          return;
        }
        if (p.type === "error") {
          const message = p.error?.message ?? "Live transcription failed.";
          if (stopRequestedRef.current && message.includes("buffer too small")) { scheduleFinalize(200); return; }
          setAudioError(message);
          teardownRealtimeStream("idle");
        }
      };

      socket.onerror = () => setAudioError("The live transcription connection dropped.");
      socket.onclose = () => {
        realtimeSocketRef.current = null;
        clearFinalizeTimer();
        stopAudioCapture();
        stopRequestedRef.current = false;
        setAudioStatus("idle");
        textareaRef.current?.focus();
      };
    } catch (caught) {
      teardownRealtimeStream("idle");
      setAudioStatus("idle");
      setAudioError(caught instanceof Error ? caught.message : "Couldn\u2019t start live voice transcription.");
    }
  }

  function stopLiveTranscription() {
    const socket = realtimeSocketRef.current;
    if (!socket || audioStatus !== "recording") return;
    stopRequestedRef.current = true;
    stopAudioCapture();
    setAudioStatus("finishing");
    clearFinalizeTimer();
    if (pendingAudioMsRef.current < 100) { scheduleFinalize(400); return; }
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      scheduleFinalize(1500);
      return;
    }
    teardownRealtimeStream("idle");
  }

  async function toggleRecording() {
    if (audioStatus === "recording") { stopLiveTranscription(); return; }
    if (audioStatus !== "idle" || wrappedUp || isThinking) return;
    await startLiveTranscription();
  }

  const composerBusy = audioStatus !== "idle";

  const status: "thinking" | "confirm" | "saved" | "ready" = isThinking
    ? "thinking"
    : wrappedUp
      ? "saved"
      : awaitingConfirmation
        ? "confirm"
        : "ready";
  const statusLabel =
    status === "thinking"
      ? "gathering"
      : status === "saved"
        ? "filed"
        : status === "confirm"
          ? "pending approval"
          : "in session";

  const phaseLabel = !hasDraft
    ? "The opening"
    : wrappedUp
      ? "Filed"
      : awaitingConfirmation
        ? "The proof"
        : "The interview";

  const composeKicker = !hasDraft
    ? "Your draft — write as you\u2019d speak"
    : wrappedUp
      ? "Dispatch filed"
      : awaitingConfirmation
        ? "Approve, or tell us what to change"
        : "Your reply";

  const placeholder = wrappedUp
    ? "Your dispatch has been filed."
    : awaitingConfirmation
      ? "Reply yes to file, or tell us what to revise\u2026"
      : needsStructuredReview
        ? "Add a rating to continue\u2026"
      : hasDraft
        ? "Type or speak your reply\u2026"
        : "Tell us about your stay, as you\u2019d tell a friend\u2026";

  const meterStops = [0, 1, 2, 3]; // intro → q1 → q2 → q3
  const meterIndex = wrappedUp ? 4 : hasDraft ? Math.min(facts.length > 0 ? 2 : 1, 3) : 0;

  const ratingBits = typeof property?.guestRating === "number";
  const starsRaw = typeof property?.starRating === "number" ? Math.min(property.starRating, 5) : 0;

  const filedDate = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  void phaseLabel;
  void composeKicker;
  void meterStops;
  void meterIndex;
  void ratingBits;
  void filedDate;

  const questionCount = messages.filter(
    (m) => m.role === "ai" && (m.kind === "question" || m.kind === "intro"),
  ).length;
  const maxTurns = 4;
  const progressDone = wrappedUp
    ? maxTurns
    : awaitingConfirmation
      ? maxTurns - 1
      : Math.min(questionCount, maxTurns);

  const ratingStars = (() => {
    if (typeof property?.guestRating !== "number") return null;
    const n = property.guestRating;
    if (n >= 9) return "Wonderful";
    if (n >= 8) return "Very good";
    if (n >= 7) return "Good";
    return "Okay";
  })();

  return (
    <div className="iv-stage">
      <div className="iv-main">
        <div className="iv-top">
          <button className="iv-back" onClick={onBack} type="button">
            <span className="arr">←</span>
            Back
          </button>
          <div className="iv-crumb">
            <span className="crumb-kicker">The Interview</span>
            <span className="crumb-sep">/</span>
            <em>{property?.city ?? "your stay"}</em>
          </div>
          <span className={`iv-status ${status}`}>
            <span className="pip" />
            {statusLabel}
          </span>
        </div>

        <div className="iv-doc">
          <div className="iv-progress" aria-hidden="true">
            {Array.from({ length: maxTurns }).map((_, i) => {
              const cls =
                i < progressDone
                  ? "done"
                  : i === progressDone
                    ? "current"
                    : "";
              return <span key={i} className={cls} />;
            })}
          </div>

          <div className="iv-body" ref={chatBodyRef}>
            <div className="iv-ornament" aria-hidden="true">※</div>

            {messages.map((m) => {
              if (m.role === "ai") {
                const kind = m.kind ?? "statement";
                return (
                  <div className={`iv-turn ai kind-${kind}`} key={m.id}>
                    <div className="turn-body">{m.text}</div>
                  </div>
                );
              }
              return (
                <div className="iv-turn user" key={m.id}>
                  <div className="turn-body">
                    {(m as { text: string }).text}
                  </div>
                </div>
              );
            })}

            {needsStructuredReview && (
              <StructuredReviewCard
                overallRating={overallRating}
                aspectRatings={aspectRatings}
                onOverallRatingChange={onOverallRatingChange}
                onAspectRatingChange={onAspectRatingChange}
                onContinue={onStructuredContinue}
                disabled={isThinking}
              />
            )}

            {awaitingConfirmation && !wrappedUp && !isThinking && (
              <div className="iv-confirm">
                <button
                  type="button"
                  className="iv-confirm-yes"
                  onClick={onApproveReview}
                >
                  <span className="yes-em">Submit review</span>
                  <span className="yes-arr">→</span>
                </button>
                <button
                  type="button"
                  className="iv-confirm-no"
                  onClick={() => textareaRef.current?.focus()}
                >
                  No, I'll edit it
                </button>
              </div>
            )}

            {isThinking && <WorkingBlock phase={thinkingPhase ?? "analyzing"} />}

            {error && <div className="iv-error">{error}</div>}
          </div>

          <div className={`iv-composer${needsStructuredReview ? " suppressed" : ""}`}>
          <div className="iv-input-row">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKey}
              placeholder={placeholder}
              disabled={wrappedUp || isThinking || composerBusy || needsStructuredReview}
              rows={1}
            />
            <button
              className={`iv-btn mic ${audioStatus === "recording" ? "recording" : ""}`}
              type="button"
              onClick={() => void toggleRecording()}
              disabled={
                wrappedUp ||
                isThinking ||
                audioStatus === "connecting" ||
                audioStatus === "finishing"
              }
              title={audioStatus === "recording" ? "Stop" : "Dictate"}
              aria-label={
                audioStatus === "recording"
                  ? "Stop transcription"
                  : "Start transcription"
              }
            >
              {audioStatus === "recording" ? <StopIcon /> : <MicIcon />}
            </button>
            <button
              className="iv-btn send"
              onClick={onSend}
              disabled={!canSend || composerBusy}
              title={sendLabel}
              aria-label={sendLabel}
              type="button"
            >
              <SendIcon />
            </button>
          </div>
          {audioError && <div className="iv-error">{audioError}</div>}
          <div className="iv-composer-hint">
            <span>
              <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
            </span>
            <span className="hint-count">
              Turn {Math.min(progressDone + (isThinking ? 1 : 0), maxTurns)} of {maxTurns}
            </span>
          </div>
          </div>
        </div>
      </div>

      <aside className="iv-dossier">
        <div className="iv-postcard">
          {propertyImageUrl ? (
            <img src={propertyImageUrl} alt={property?.city ?? "Property"} />
          ) : (
            <div className="postcard-placeholder" />
          )}
          <div className="postcard-meta">
            <div className="postcard-loc">
              {[property?.city, property?.country].filter(Boolean).join(" · ") ||
                "The subject"}
            </div>
            <h3 className="postcard-title">
              <em>{property?.city ?? "Your stay"}</em>
            </h3>
            {ratingLabel !== "\u2014" && (
              <div className="postcard-rating">
                <span className="chip">{ratingLabel}</span>
                {ratingStars && <span className="word">{ratingStars}</span>}
                <span className="meta">
                  · {reviewCount} review{reviewCount === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="dossier-section">
          <div className="dossier-label">About the subject</div>
          <p className="dossier-sum">{property?.propertySummary}</p>
          <p className="dossier-sum">
            {recomputeMeta}
            {typeof property?.firstPartyReviewCount === "number"
              ? ` · ${property.firstPartyReviewCount} traveler review${property.firstPartyReviewCount === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>

        {facts.length > 0 && (
          <div className="dossier-section">
            <div className="dossier-label">
              <span>Facts captured</span>
              <span className="label-count">{facts.length}</span>
            </div>
            <div className="facts-index">
              {facts.map((fact, i) => (
                <div className="fx-item" key={`${fact.factType}-${i}`}>
                  <label className="fx-key">
                    <input
                      type="checkbox"
                      checked={fact.selected}
                      disabled={!awaitingConfirmation}
                      onChange={() => onToggleFactSelection(fact.id)}
                    />
                    {formatFactLabel(fact)}
                  </label>
                  {awaitingConfirmation && fact.editable ? (
                    <input
                      className="fx-val"
                      value={fact.editedValue}
                      onChange={(e) => onFactValueChange(fact.id, e.target.value)}
                    />
                  ) : (
                    <span className="fx-val">{formatFactValue(fact.value)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tripContext && (
          <div className="dossier-section">
            <div className="dossier-label">Trip context</div>
            <div className="facts-index">
              {tripContext.tripType && (
                <div className="fx-item">
                  <span className="fx-key">trip type</span>
                  <span className="fx-val">{tripContext.tripType.replaceAll("_", " ")}</span>
                </div>
              )}
              {tripContext.stayLengthBucket && (
                <div className="fx-item">
                  <span className="fx-key">stay length</span>
                  <span className="fx-val">{tripContext.stayLengthBucket.replaceAll("_", " ")}</span>
                </div>
              )}
              {tripContext.arrivalTimeBucket && (
                <div className="fx-item">
                  <span className="fx-key">arrival</span>
                  <span className="fx-val">{tripContext.arrivalTimeBucket.replaceAll("_", " ")}</span>
                </div>
              )}
              {tripContext.roomType && (
                <div className="fx-item">
                  <span className="fx-key">room type</span>
                  <span className="fx-val">{tripContext.roomType}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {wrappedUp && (
          <div className="iv-filed">
            <div className="filed-kicker">Dispatch filed</div>
            <div className="filed-big">
              <em>Filed.</em>
            </div>
            <div className="filed-sub">Your review is on the record.</div>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Utilities & Icons
   ═══════════════════════════════════════════════════════ */

function formatFactValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v === null || v === undefined) return "\u2014";
  if (typeof v === "number") return String(v);
  return String(v);
}

function coerceFactInputValue(originalValue: unknown, editedValue: string): string | number | boolean {
  if (typeof originalValue === "boolean") {
    return /^(true|yes|y|1)$/i.test(editedValue.trim());
  }
  if (typeof originalValue === "number") {
    const parsed = Number.parseFloat(editedValue.trim());
    return Number.isFinite(parsed) ? parsed : originalValue;
  }
  return editedValue.trim();
}

function formatFactLabel(fact: Fact): string {
  if (fact.factType === "review_detail") {
    return "from your review";
  }
  if (fact.factType === "freeform_note") {
    return "note";
  }
  return String(fact.factType ?? "").replaceAll("_", " ");
}

function formatShortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function buildRatingSummary(
  overallRating: number,
  aspectRatings: AspectRatings,
): string {
  const aspectParts = (
    [
      ["service", "service"],
      ["cleanliness", "cleanliness"],
      ["amenities", "amenities"],
      ["value", "value"],
    ] as Array<[keyof AspectRatings, string]>
  )
    .filter(([key]) => typeof aspectRatings[key] === "number")
    .map(([key, label]) => `${label} ${aspectRatings[key]}/5`);

  if (aspectParts.length === 0) {
    return `${overallRating}/10 overall`;
  }

  return `${overallRating}/10 overall · ${aspectParts.join(" · ")}`;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 15a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Zm7-4a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.08A7 7 0 0 0 19 11Z"
        fill="currentColor"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4l0 16M12 4l-5 5M12 4l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
