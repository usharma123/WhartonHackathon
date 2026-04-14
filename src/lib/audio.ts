export const MAX_AUDIO_FILE_BYTES = 24 * 1024 * 1024;
export const MAX_AUDIO_FILE_MB = Math.floor(MAX_AUDIO_FILE_BYTES / (1024 * 1024));

const AUDIO_FILE_EXTENSION = /\.(m4a|mp3|mp4|mpeg|mpga|oga|ogg|wav|webm)$/i;

export function appendTranscriptToDraft(draft: string, transcript: string): string {
  const nextDraft = draft.trim();
  const nextTranscript = transcript.trim();

  if (!nextTranscript) {
    return nextDraft;
  }
  if (!nextDraft) {
    return nextTranscript;
  }
  return `${nextDraft}\n\n${nextTranscript}`;
}

export function looksLikeAudioFile(file: { type?: string; name?: string }): boolean {
  if (typeof file.type === "string" && file.type.startsWith("audio/")) {
    return true;
  }
  return typeof file.name === "string" ? AUDIO_FILE_EXTENSION.test(file.name) : false;
}
