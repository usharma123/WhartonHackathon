export const LIVE_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
export const REALTIME_SESSION_MODEL = "gpt-realtime-mini";
export const REALTIME_AUDIO_SAMPLE_RATE = 24000;

export function insertOrderedItemId(
  itemIds: string[],
  itemId: string,
  previousItemId?: string | null,
): string[] {
  if (itemIds.includes(itemId)) {
    return itemIds;
  }
  if (!previousItemId) {
    return [itemId, ...itemIds];
  }

  const previousIndex = itemIds.indexOf(previousItemId);
  if (previousIndex === -1) {
    return [...itemIds, itemId];
  }

  return [
    ...itemIds.slice(0, previousIndex + 1),
    itemId,
    ...itemIds.slice(previousIndex + 1),
  ];
}

export function float32ToPCM16(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = REALTIME_AUDIO_SAMPLE_RATE,
): Int16Array {
  const samples =
    inputSampleRate === targetSampleRate
      ? input
      : downsampleFloat32(input, inputSampleRate, targetSampleRate);

  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";

  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function downsampleFloat32(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (targetSampleRate > inputSampleRate) {
    throw new Error("Target sample rate must not exceed the input sample rate.");
  }

  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / sampleRateRatio));
  const output = new Float32Array(outputLength);

  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.round((outputIndex + 1) * sampleRateRatio);
    let sum = 0;
    let count = 0;

    for (let index = inputIndex; index < nextInputIndex && index < input.length; index += 1) {
      sum += input[index] ?? 0;
      count += 1;
    }

    output[outputIndex] = count > 0 ? sum / count : 0;
    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}
