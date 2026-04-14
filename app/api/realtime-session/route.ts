import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  LIVE_TRANSCRIPTION_MODEL,
  REALTIME_SESSION_MODEL,
} from "../../../src/lib/realtimeAudio";

export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY on the server." },
      { status: 500 },
    );
  }

  try {
    const client = new OpenAI({ apiKey });
    const secret = await client.realtime.clientSecrets.create({
      expires_after: {
        anchor: "created_at",
        seconds: 60,
      },
      session: {
        type: "realtime",
        model: REALTIME_SESSION_MODEL,
        output_modalities: ["text"],
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            noise_reduction: {
              type: "near_field",
            },
            transcription: {
              model: LIVE_TRANSCRIPTION_MODEL,
              language: "en",
              prompt:
                "This is a spoken hotel review or follow-up answer about a stay, including check-in, breakfast, parking, staff, noise, amenities, and cleanliness.",
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 400,
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    });

    return NextResponse.json({
      clientSecret: secret.value,
      expiresAt: secret.expires_at,
      model: REALTIME_SESSION_MODEL,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Couldn't create a realtime session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
