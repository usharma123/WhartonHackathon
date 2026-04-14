import { describe, expect, it } from "vitest";

import {
  LIVE_TRANSCRIPTION_MODEL,
  REALTIME_AUDIO_SAMPLE_RATE,
  REALTIME_SESSION_MODEL,
  float32ToPCM16,
  insertOrderedItemId,
  pcm16ToBase64,
} from "../src/lib/realtimeAudio";

describe("realtime audio helpers", () => {
  it("inserts committed items in conversation order", () => {
    expect(insertOrderedItemId(["item_1", "item_3"], "item_2", "item_1")).toEqual([
      "item_1",
      "item_2",
      "item_3",
    ]);
  });

  it("converts float samples to pcm16", () => {
    expect(Array.from(float32ToPCM16(new Float32Array([-1, 0, 1]), 24000))).toEqual([
      -32768,
      0,
      32767,
    ]);
  });

  it("encodes pcm16 bytes to base64", () => {
    expect(pcm16ToBase64(new Int16Array([0, 1]))).toBe("AAABAA==");
  });

  it("exports the live transcription constants", () => {
    expect(LIVE_TRANSCRIPTION_MODEL).toBe("gpt-4o-mini-transcribe");
    expect(REALTIME_SESSION_MODEL).toBe("gpt-realtime-mini");
    expect(REALTIME_AUDIO_SAMPLE_RATE).toBe(24000);
  });
});
