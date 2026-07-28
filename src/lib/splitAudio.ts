/** Client-side audio splitting for files larger than the API limit. */

import { encodeWav } from "./wav";

export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // 24 MiB (Groq limit)

// 16 kHz mono 16-bit PCM ≈ 32_000 bytes/s → ~10 min ≈ 18.3 MiB (safe under 24 MiB)
const PART_SECONDS = 10 * 60;
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
): Promise<AudioPart[]> {
  const arrayBuffer = await source.arrayBuffer();
  const ctx = new AudioContext();
  try {
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

      const slice = channelData.subarray(startSample, endSample);
      const blob = encodeWav([slice], sampleRate, TARGET_RATE);
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
