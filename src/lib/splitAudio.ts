/** Client-side audio splitting — by size AND by duration. */

import { encodeWav } from "./wav";

export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // 24 MiB (Groq limit)

// Keep parts short so serverless / proxy timeouts don't kill the request.
// 16 kHz mono 16-bit PCM ≈ 32_000 bytes/s → 90s ≈ 2.9 MiB
export const PART_SECONDS = 90;
const TARGET_RATE = 16_000;

// If decoded duration exceeds this, always split (even when file size is small).
export const MAX_SINGLE_DURATION_SEC = 90;

export type AudioPart = {
  blob: Blob;
  name: string;
  offsetSeconds: number;
  index: number;
  total: number;
};

export type PreparedAudio = {
  parts: AudioPart[];
  totalSeconds: number;
};

/**
 * Decode audio and return one or more WAV parts under size/duration limits.
 * Always returns at least one part when decoding succeeds.
 */
export async function prepareAudioForTranscription(
  source: Blob,
  baseName = "part",
  onProgress?: (msg: string) => void,
): Promise<PreparedAudio> {
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

    onProgress?.(
      partCount > 1
        ? `صوت ${Math.ceil(totalSeconds / 60)} دقیقه‌ای به ${partCount} بخش تقسیم می‌شود…`
        : "آماده‌سازی فایل…",
    );

    const parts: AudioPart[] = [];
    for (let i = 0; i < partCount; i++) {
      const startSample = Math.floor(i * PART_SECONDS * sampleRate);
      const endSample = Math.min(
        channelData.length,
        Math.floor((i + 1) * PART_SECONDS * sampleRate),
      );
      if (endSample <= startSample) continue;

      if (partCount > 1) {
        onProgress?.(`آماده‌سازی بخش ${i + 1} از ${partCount}…`);
      }
      await yieldToUi();

      const slice = channelData.subarray(startSample, endSample);
      const copy = new Float32Array(slice);
      const blob = encodeWav([copy], sampleRate, TARGET_RATE);
      parts.push({
        blob,
        name:
          partCount === 1
            ? `${baseName}.wav`
            : `${baseName}-part${String(i + 1).padStart(3, "0")}.wav`,
        offsetSeconds: i * PART_SECONDS,
        index: i,
        total: partCount,
      });
    }
    return { parts, totalSeconds };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** @deprecated use prepareAudioForTranscription */
export async function splitAudioForUpload(
  source: Blob,
  baseName = "part",
  onProgress?: (msg: string) => void,
): Promise<AudioPart[]> {
  const { parts } = await prepareAudioForTranscription(source, baseName, onProgress);
  return parts;
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
