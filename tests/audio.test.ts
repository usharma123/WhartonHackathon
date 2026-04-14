import { describe, expect, it } from "vitest";

import {
  MAX_AUDIO_FILE_BYTES,
  MAX_AUDIO_FILE_MB,
  appendTranscriptToDraft,
  looksLikeAudioFile,
} from "../src/lib/audio";

describe("audio helpers", () => {
  it("appends a transcript without losing the existing draft", () => {
    expect(appendTranscriptToDraft("The room was quiet.", "Breakfast was solid.")).toBe(
      "The room was quiet.\n\nBreakfast was solid.",
    );
  });

  it("returns whichever side has content when one side is empty", () => {
    expect(appendTranscriptToDraft("", "Voice note")).toBe("Voice note");
    expect(appendTranscriptToDraft("Typed note", "")).toBe("Typed note");
  });

  it("accepts audio mime types and known file extensions", () => {
    expect(looksLikeAudioFile({ type: "audio/webm", name: "voice-note.webm" })).toBe(true);
    expect(looksLikeAudioFile({ type: "", name: "voice-note.m4a" })).toBe(true);
    expect(looksLikeAudioFile({ type: "image/png", name: "image.png" })).toBe(false);
  });

  it("exports the configured upload limit", () => {
    expect(MAX_AUDIO_FILE_MB).toBe(24);
    expect(MAX_AUDIO_FILE_BYTES).toBe(24 * 1024 * 1024);
  });
});
