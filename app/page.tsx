"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../convex/_generated/api";
import { appendTranscriptToDraft } from "../src/lib/audio";
import {
  REALTIME_AUDIO_SAMPLE_RATE,
  float32ToPCM16,
  insertOrderedItemId,
  pcm16ToBase64,
} from "../src/lib/realtimeAudio";

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
          <span className="mark">R</span>
          <div>
            <div>ReviewGap</div>
            <div className="brand-sub">Traveler Demo</div>
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
  onSelect,
  onStart,
}: {
  properties: DemoProperty[];
  selected: DemoProperty | null;
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
  const ratingLabel =
    typeof selected?.guestRating === "number" ? selected.guestRating.toFixed(1) : "4.6";
  const starRatingLabel =
    typeof selected?.starRating === "number" ? selected.starRating.toFixed(1) : "—";
  const reviewCountLabel = `${selected?.reviewCount ?? 0}`;
  const amenityChips =
    selected?.popularAmenities
      ?.split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6) ??
    (selected?.demoFlags ?? ["wifi", "breakfast", "gym", "pool", "pet friendly"]).slice(0, 6);

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
                <span className="star">★</span>{ratingLabel}
              </span>
            </div>
            <div className="property-stat">
              <span className="k">Reviews</span>
              <span className="v">{reviewCountLabel}</span>
            </div>
            <div className="property-stat">
              <span className="k">Stars</span>
              <span className="v">{starRatingLabel}</span>
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
            {amenityChips.map((flag) => (
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
            <span className="caption">{properties.length} seeded from data</span>
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
  const ratingLabel =
    typeof selected?.guestRating === "number" ? selected.guestRating.toFixed(1) : "4.6";
  const reviewCountLabel = `${selected?.reviewCount ?? 0} reviews`;
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptBaseDraftRef = useRef("");
  const transcriptOrderRef = useRef<string[]>([]);
  const transcriptByItemIdRef = useRef(new Map<string, string>());
  const stopRequestedRef = useRef(false);
  const finalizeTimerRef = useRef<number | null>(null);
  const [audioStatus, setAudioStatus] = useState<"idle" | "connecting" | "recording" | "finishing">("idle");
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (finalizeTimerRef.current !== null) {
        window.clearTimeout(finalizeTimerRef.current);
      }
      finalizeTimerRef.current = null;
      processorNodeRef.current?.disconnect();
      processorNodeRef.current = null;
      sourceNodeRef.current?.disconnect();
      sourceNodeRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => undefined);
      }
      audioContextRef.current = null;
      if (realtimeSocketRef.current) {
        realtimeSocketRef.current.onopen = null;
        realtimeSocketRef.current.onmessage = null;
        realtimeSocketRef.current.onerror = null;
        realtimeSocketRef.current.onclose = null;
        realtimeSocketRef.current.close();
      }
      realtimeSocketRef.current = null;
    };
  }, []);

  function clearFinalizeTimer() {
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
    }
    finalizeTimerRef.current = null;
  }

  function stopAudioCapture() {
    processorNodeRef.current?.disconnect();
    processorNodeRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
    }
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
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    }

    stopRequestedRef.current = false;
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
    const existingItemIds = transcriptOrderRef.current;
    const fallbackPreviousItemId =
      previousItemId === undefined ? (existingItemIds.at(-1) ?? null) : previousItemId;

    transcriptOrderRef.current = insertOrderedItemId(
      existingItemIds,
      itemId,
      fallbackPreviousItemId,
    );
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
      setAudioError("Live voice transcription isn't available in this browser.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioError("Microphone access isn't available in this browser.");
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
      stopRequestedRef.current = false;
      clearFinalizeTimer();

      const response = await fetch("/api/realtime-session", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { clientSecret?: string; model?: string; error?: string }
        | null;

      if (!response.ok || !payload?.clientSecret || !payload.model) {
        throw new Error(payload?.error ?? "Couldn't start a live transcription session.");
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
            (window as typeof window & { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;

          if (!AudioContextCtor) {
            throw new Error("This browser can't create a live audio stream.");
          }

          const audioContext = new AudioContextCtor({
            sampleRate: REALTIME_AUDIO_SAMPLE_RATE,
          });
          audioContextRef.current = audioContext;
          if (audioContext.state === "suspended") {
            await audioContext.resume();
          }

          const sourceNode = audioContext.createMediaStreamSource(stream);
          const processorNode = audioContext.createScriptProcessor(4096, 1, 1);

          processorNode.onaudioprocess = (audioEvent) => {
            const liveSocket = realtimeSocketRef.current;
            if (
              !liveSocket ||
              liveSocket.readyState !== WebSocket.OPEN ||
              stopRequestedRef.current
            ) {
              return;
            }

            const samples = audioEvent.inputBuffer.getChannelData(0);
            const pcm = float32ToPCM16(samples, audioContext.sampleRate);
            if (pcm.length === 0) {
              return;
            }

            liveSocket.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: pcm16ToBase64(pcm),
              }),
            );
          };

          sourceNode.connect(processorNode);
          processorNode.connect(audioContext.destination);

          sourceNodeRef.current = sourceNode;
          processorNodeRef.current = processorNode;
          setAudioStatus("recording");
        } catch (caught) {
          setAudioError(
            caught instanceof Error
              ? caught.message
              : "Couldn't start live voice transcription.",
          );
          teardownRealtimeStream("idle");
        }
      };

      socket.onmessage = (messageEvent) => {
        const payload = JSON.parse(messageEvent.data) as {
          type?: string;
          item_id?: string;
          previous_item_id?: string | null;
          delta?: string;
          transcript?: string;
          error?: { message?: string };
        };
        const itemId = payload.item_id;

        if (payload.type === "input_audio_buffer.committed" && itemId) {
          ensureTranscriptItem(itemId, payload.previous_item_id);
          if (stopRequestedRef.current) {
            scheduleFinalize();
          }
          return;
        }

        if (payload.type === "conversation.item.input_audio_transcription.delta" && itemId) {
          ensureTranscriptItem(itemId);
          const nextTranscript =
            (transcriptByItemIdRef.current.get(itemId) ?? "") + (payload.delta ?? "");
          transcriptByItemIdRef.current.set(itemId, nextTranscript);
          refreshDraftFromTranscriptState();
          if (stopRequestedRef.current) {
            scheduleFinalize();
          }
          return;
        }

        if (payload.type === "conversation.item.input_audio_transcription.completed" && itemId) {
          ensureTranscriptItem(itemId);
          transcriptByItemIdRef.current.set(itemId, payload.transcript ?? "");
          refreshDraftFromTranscriptState();
          if (stopRequestedRef.current) {
            scheduleFinalize();
          }
          return;
        }

        if (payload.type === "conversation.item.input_audio_transcription.failed") {
          setAudioError(payload.error?.message ?? "Live transcription failed.");
          teardownRealtimeStream("idle");
          return;
        }

        if (payload.type === "error") {
          setAudioError(payload.error?.message ?? "Live transcription failed.");
          teardownRealtimeStream("idle");
        }
      };

      socket.onerror = () => {
        setAudioError("The live transcription connection dropped.");
      };

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
      setAudioError(
        caught instanceof Error
          ? caught.message
          : "Couldn't start live voice transcription.",
      );
    }
  }

  function stopLiveTranscription() {
    const socket = realtimeSocketRef.current;
    if (!socket || audioStatus !== "recording") {
      return;
    }

    stopRequestedRef.current = true;
    stopAudioCapture();
    setAudioStatus("finishing");
    clearFinalizeTimer();

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "input_audio_buffer.commit",
        }),
      );
      scheduleFinalize(1500);
      return;
    }

    teardownRealtimeStream("idle");
  }

  async function toggleRecording() {
    if (audioStatus === "recording") {
      stopLiveTranscription();
      return;
    }
    if (audioStatus !== "idle" || wrappedUp || isThinking) {
      return;
    }
    await startLiveTranscription();
  }

  const composerBusy = audioStatus !== "idle";
  const composerStatusText =
    audioStatus === "connecting"
      ? "Connecting your microphone…"
      : audioStatus === "recording"
        ? "Listening live… tap the mic again to stop."
        : audioStatus === "finishing"
          ? "Finalizing your transcript…"
          : "Click the mic and your speech will stream into the draft live.";

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
          <div className="composer-tools">
            <div className="composer-status">
              {composerStatusText}
            </div>
          </div>
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
                    ? "Type or tap the mic to reply…"
                    : "Type or tap the mic to tell us about your stay…"
              }
              disabled={wrappedUp || isThinking || composerBusy}
              rows={1}
            />
            <button
              className={`chat-icon-button mic ${audioStatus === "recording" ? "recording" : ""}`}
              type="button"
              onClick={() => void toggleRecording()}
              disabled={wrappedUp || isThinking || audioStatus === "connecting" || audioStatus === "finishing"}
              title={audioStatus === "recording" ? "Stop live transcription" : "Start live transcription"}
              aria-label={audioStatus === "recording" ? "Stop live transcription" : "Start live transcription"}
            >
              {audioStatus === "recording" ? <StopIcon /> : <MicIcon />}
            </button>
            <button
              className="chat-send"
              onClick={onSend}
              disabled={!canSend || composerBusy}
              title={sendLabel}
              aria-label={sendLabel}
            >
              ↑
            </button>
          </div>
          {audioError ? <div className="composer-note error">{audioError}</div> : null}
          <span className="chat-footer-note">
            Press Enter to send · Shift + Enter for a new line · Voice streams live transcription
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
            <span>{ratingLabel} · {reviewCountLabel}</span>
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
