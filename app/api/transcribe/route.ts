import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  MAX_AUDIO_FILE_BYTES,
  MAX_AUDIO_FILE_MB,
  looksLikeAudioFile,
} from "../../../src/lib/audio";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY on the server." },
      { status: 500 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Attach an audio file." }, { status: 400 });
    }
    if (!looksLikeAudioFile(file)) {
      return NextResponse.json(
        { error: "Only audio uploads are supported for transcription." },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The audio file is empty." }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_FILE_BYTES) {
      return NextResponse.json(
        { error: `Audio must be ${MAX_AUDIO_FILE_MB}MB or smaller.` },
        { status: 400 },
      );
    }

    const client = new OpenAI({ apiKey });
    const transcript = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      temperature: 0,
      response_format: "json",
      prompt:
        "This is a spoken hotel review or follow-up answer about a stay, including amenities, check-in, breakfast, parking, staff, noise, and cleanliness.",
    });

    return NextResponse.json({ text: transcript.text ?? "" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Whisper transcription failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
