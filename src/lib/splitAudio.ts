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
 * Decode once, then mix+downsample+encode **one part at a time**.
 * Peak memory ≈ decoded AudioBuffer + one part PCM (not the whole file as Float32).
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

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await source.arrayBuffer();
  } catch {
    throw new Error("خواندن فایل در مرورگر ممکن نشد (حافظه کافی نیست). فایل کوچک‌تری امتحان کنید.");
  }

  // decodeAudioData transfers/detaches the buffer on modern engines — no extra .slice()
  // Use OfflineAudioContext for decoding: it never touches the live audio output device,
  // so it can't interrupt/stop any other <audio> element that happens to be playing
  // (a live AudioContext can seize the audio hardware and stop other playback on some
  // browsers/OSes).
  const OfflineCtor = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
    || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    || null;
  const decodeCtx: OfflineAudioContext | AudioContext = OfflineCtor ? new OfflineCtor(1, 1, 44100) : new AudioContext();
  let decoded: AudioBuffer;
  try {
    onProgress?.("در حال رمزگشایی صوت…");
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } catch {
    if (!OfflineCtor) await (decodeCtx as AudioContext).close().catch(() => {});
    throw new Error("رمزگشایی صوت ناموفق بود. فرمت فایل را بررسی کنید.");
  } finally {
    // @ts-expect-error intentional release
    arrayBuffer = null;
    if (!OfflineCtor) await (decodeCtx as AudioContext).close().catch(() => {});
  }

  const srcRate = decoded.sampleRate;
  const channels = decoded.numberOfChannels;
  const srcLength = decoded.length;
  const totalSeconds = srcLength / srcRate;
  const partCount = Math.max(1, Math.ceil(totalSeconds / partSeconds));

  onProgress?.(
    partCount > 1
      ? `صوت ${Math.ceil(totalSeconds / 60)} دقیقه‌ای به ${partCount} بخش ${minutes} دقیقه‌ای تقسیم می‌شود…`
      : "آماده‌سازی فایل…",
  );

  // Channel views only (no full mono of entire file).
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(decoded.getChannelData(c));
  const invCh = 1 / channels;
  const ratio = srcRate / TARGET_RATE;

  const parts: AudioPart[] = [];
  for (let i = 0; i < partCount; i++) {
    if (partCount > 1) onProgress?.(`آماده‌سازی بخش ${i + 1} از ${partCount}…`);
    await yieldToUi();

    const startSrc = Math.min(srcLength, Math.floor(i * partSeconds * srcRate));
    const endSrc = Math.min(srcLength, Math.floor((i + 1) * partSeconds * srcRate));
    if (endSrc <= startSrc) continue;

    const outLength = Math.max(1, Math.floor((endSrc - startSrc) / ratio));
    let mono: Float32Array;
    try {
      mono = new Float32Array(outLength);
    } catch {
      // free as much as possible before throwing
      chans.length = 0;
      // @ts-expect-error intentional release
      decoded = null;
      throw new Error(
        "حافظهٔ دستگاه برای این فایل کافی نیست. فایل کوتاه‌تر آپلود کنید یا از دستگاه دیگری استفاده کنید.",
      );
    }

    // Mix + downsample only this part
    const block = 24_000;
    for (let o0 = 0; o0 < outLength; o0 += block) {
      const o1 = Math.min(outLength, o0 + block);
      for (let o = o0; o < o1; o++) {
        const srcIndex = Math.min(srcLength - 1, startSrc + Math.floor(o * ratio));
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += chans[c][srcIndex];
        mono[o] = sum * invCh;
      }
      if (o1 < outLength) await yieldToUi();
    }

    const blob = encodePcm16Wav(mono, TARGET_RATE);
    // drop part PCM ASAP (Blob holds its own copy)
    // @ts-expect-error intentional release
    mono = null;

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

  chans.length = 0;
  // @ts-expect-error intentional release
  decoded = null;
  await yieldToUi();

  return { parts, totalSeconds };
}

/** Encode already-16kHz mono Float32 samples to 16-bit PCM WAV. */
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
