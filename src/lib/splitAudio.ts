/** Client-side audio splitting — memory-safe path for long files. */

export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // 24 MiB (Groq limit)

export const DEFAULT_PART_MINUTES = 2;

const TARGET_RATE = 16_000;
const BYTES_PER_SEC = 32_000; // 16 kHz mono 16-bit

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

export function clampPartMinutes(minutes: number): number {
  const n = Number.isFinite(minutes) ? Math.floor(minutes) : DEFAULT_PART_MINUTES;
  const maxMin = Math.floor((MAX_UPLOAD_BYTES - 1024) / BYTES_PER_SEC / 60);
  return Math.min(Math.max(1, n), maxMin);
}

/**
 * Decode → mix to mono → downsample to 16 kHz in one pass, then split.
 * Avoids keeping full-rate multi-channel PCM in memory (main cause of Chrome "Aw, Snap!").
 */
export async function prepareAudioForTranscription(
  source: Blob,
  baseName = "part",
  onProgress?: (msg: string) => void,
  partMinutes: number = DEFAULT_PART_MINUTES,
): Promise<PreparedAudio> {
  const minutes = clampPartMinutes(partMinutes);
  const partSeconds = minutes * 60;

  onProgress?.("در حال خواندن فایل…");
  // Prefer OfflineAudioContext when available (lighter than interactive AudioContext on mobile).
  const Offline =
    typeof OfflineAudioContext !== "undefined"
      ? OfflineAudioContext
      : typeof webkitOfflineAudioContext !== "undefined"
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (webkitOfflineAudioContext as any)
        : null;

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await source.arrayBuffer();
  } catch {
    throw new Error("خواندن فایل در مرورگر ممکن نشد (حافظه کافی نیست). فایل کوچک‌تری امتحان کنید.");
  }

  // Decode with a short-lived context, then close immediately.
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    onProgress?.("در حال رمزگشایی صوت…");
    // slice(0) keeps a copy so the original buffer can be GC'd after decode on some engines
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    await decodeCtx.close().catch(() => {});
    throw new Error("رمزگشایی صوت ناموفق بود. فرمت فایل را بررسی کنید.");
  } finally {
    // Drop reference to compressed bytes as soon as decode finishes.
    // @ts-expect-error intentional release
    arrayBuffer = null;
    await decodeCtx.close().catch(() => {});
  }

  const srcRate = decoded.sampleRate;
  const channels = decoded.numberOfChannels;
  const srcLength = decoded.length;
  const totalSeconds = srcLength / srcRate;

  // Build 16 kHz mono in one pass — much smaller than full-rate float buffers.
  onProgress?.("در حال آماده‌سازی صوت با کیفیت بهینه…");
  await yieldToUi();

  const ratio = srcRate / TARGET_RATE;
  const outLength = Math.max(1, Math.floor(srcLength / ratio));
  let mono16k: Float32Array;
  try {
    mono16k = new Float32Array(outLength);
  } catch {
    throw new Error(
      "حافظهٔ دستگاه برای این فایل کافی نیست. فایل کوتاه‌تر آپلود کنید یا از گوشی دیگری استفاده کنید.",
    );
  }

  // Read channel views once (no full-channel copies).
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    chans.push(decoded.getChannelData(c));
  }

  const invCh = 1 / channels;
  const chunkOut = 48_000; // process in blocks to yield to UI
  for (let o0 = 0; o0 < outLength; o0 += chunkOut) {
    const o1 = Math.min(outLength, o0 + chunkOut);
    for (let o = o0; o < o1; o++) {
      const srcIndex = Math.min(srcLength - 1, Math.floor(o * ratio));
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += chans[c][srcIndex];
      mono16k[o] = sum * invCh;
    }
    if (o1 < outLength) await yieldToUi();
  }

  // Release decoded AudioBuffer / channel refs for GC before encoding parts.
  // @ts-expect-error intentional release
  decoded = null;
  chans.length = 0;
  await yieldToUi();

  const partCount = Math.max(1, Math.ceil(totalSeconds / partSeconds));
  onProgress?.(
    partCount > 1
      ? `صوت ${Math.ceil(totalSeconds / 60)} دقیقه‌ای به ${partCount} بخش ${minutes} دقیقه‌ای تقسیم می‌شود…`
      : "آماده‌سازی فایل…",
  );

  const parts: AudioPart[] = [];
  for (let i = 0; i < partCount; i++) {
    const startSample = Math.floor(i * partSeconds * TARGET_RATE);
    const endSample = Math.min(mono16k.length, Math.floor((i + 1) * partSeconds * TARGET_RATE));
    if (endSample <= startSample) continue;

    if (partCount > 1) onProgress?.(`آماده‌سازی بخش ${i + 1} از ${partCount}…`);
    await yieldToUi();

    // subarray is a view — encodeWav must not retain it after the Blob is built.
    const view = mono16k.subarray(startSample, endSample);
    const blob = encodePcm16Wav(view, TARGET_RATE);
    parts.push({
      blob,
      name:
        partCount === 1
          ? `${baseName}.wav`
          : `${baseName}-part${String(i + 1).padStart(3, "0")}.wav`,
      offsetSeconds: i * partSeconds,
      index: i,
      total: partCount,
    });
  }

  // @ts-expect-error intentional release
  mono16k = null;

  void Offline; // keep reference shape for future offline render path
  return { parts, totalSeconds };
}

/** Encode already-16kHz mono Float32 samples to 16-bit PCM WAV without extra resample. */
function encodePcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeString = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataBytes, true);
  let pos = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    pos += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
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

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// Safari legacy
declare const webkitOfflineAudioContext: typeof OfflineAudioContext | undefined;
