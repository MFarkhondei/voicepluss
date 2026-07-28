/** Client-side audio splitting for files larger than the API limit. */

import { encodeWav } from "./wav";

export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // 24 MiB (Groq limit)

// Shorter parts reduce serverless timeouts and memory spikes.
// 16 kHz mono 16-bit PCM ≈ 32_000 bytes/s → 3 min ≈ 5.5 MiB
export const PART_SECONDS = 3 * 60;
const TARGET_RATE = 16_000;

export type AudioPart = {
  blob: Blob;
  name: string;
  /** Start time of this part in the original audio (seconds). */
  offsetSeconds: number;
  index: number;
  total: number;
};

/**
 * Decode any browser-supported audio/video blob and split into WAV parts
 * that each stay under MAX_UPLOAD_BYTES.
 */
export async function splitAudioForUpload(
  source: Blob,
  baseName = "part",
  onProgress?: (msg: string) => void,
): Promise<AudioPart[]> {
  onProgress?.("در حال خواندن فایل…");
  const arrayBuffer = await source.arrayBuffer();
  const ctx = new AudioContext();
  try {
    onProgress?.("در حال رمزگشایی صوت…");
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const sampleRate = decoded.sampleRate;
    const channelData = mixToMono(decoded);
    const totalSeconds = channelData.length / sampleRate;
    const partCount = Math.max(1, Math.ceil(totalSeconds / PART_SECONDS));

    const parts: AudioPart[] = [];
    for (let i = 0; i < partCount; i++) {
      const startSample = Math.floor(i * PART_SECONDS * sampleRate);
      const endSample = Math.min(
        channelData.length,
        Math.floor((i + 1) * PART_SECONDS * sampleRate),
      );
      if (endSample <= startSample) continue;

      onProgress?.(`در حال آماده‌سازی بخش ${i + 1} از ${partCount}…`);
      // Yield so the UI can paint between heavy encode steps
      await yieldToUi();

      const slice = channelData.subarray(startSample, endSample);
      // Copy slice — subarray views can be invalidated after GC of parent
      const copy = new Float32Array(slice);
      const blob = encodeWav([copy], sampleRate, TARGET_RATE);
      parts.push({
        blob,
        name: `${baseName}-part${String(i + 1).padStart(3, "0")}.wav`,
        offsetSeconds: i * PART_SECONDS,
        index: i,
        total: partCount,
      });
    }
    return parts;
  } finally {
    await ctx.close().catch(() => {});
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }
  const out = new Float32Array(length);
  for (let c = 0; c < numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      out[i] += ch[i] / numberOfChannels;
    }
  }
  return out;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
