/** استخراج پیک‌های دامنهٔ صوت برای رسم waveform.
 * برای فایل‌های بزرگ دیکود کامل انجام نمی‌شود تا تب کروم کرش نکند. */

/** بالای این حجم: فقط الگوی تقریبی (بدون decodeAudioData) */
const MAX_DECODE_BYTES = 12 * 1024 * 1024;

export async function extractPeaks(blob: Blob, barCount = 120): Promise<number[]> {
  // فایل بزرگ / ویدیو: دیکود دوباره = کرش حافظه (Aw, Snap!)
  if (blob.size > MAX_DECODE_BYTES) {
    return fallbackPeaks(blob.size, barCount);
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new AudioContext();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const channels = decoded.numberOfChannels;
      const length = decoded.length;
      if (length === 0) return fallbackPeaks(blob.size, barCount);

      // نمونه‌برداری تنک: فقط یک نمونه از هر سطل — بدون ساخت آرایهٔ full-length mono
      const bucketSize = Math.max(1, Math.floor(length / barCount));
      const rawPeaks: number[] = [];
      for (let i = 0; i < barCount; i++) {
        const start = i * bucketSize;
        const end = Math.min(length, start + bucketSize);
        // stride داخل سطل تا حلقه سبک‌تر شود
        const step = Math.max(1, Math.floor((end - start) / 64));
        let max = 0;
        for (let j = start; j < end; j += step) {
          let sum = 0;
          for (let c = 0; c < channels; c++) {
            sum += Math.abs(decoded.getChannelData(c)[j]);
          }
          const v = sum / channels;
          if (v > max) max = v;
        }
        rawPeaks.push(max);
      }

      const peakMax = Math.max(...rawPeaks, 0.0001);
      return rawPeaks.map((p) => Math.min(1, p / peakMax));
    } finally {
      void ctx.close();
    }
  } catch {
    return fallbackPeaks(blob.size, barCount);
  }
}

/** الگوی شبه‌تصادفیِ پایدار (seed = حجم فایل) وقتی دیکود ممکن/ایمن نیست. */
function fallbackPeaks(sizeBytes: number, barCount: number): number[] {
  let seed = (sizeBytes % 100000) || 12345;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: barCount }, () => 0.22 + rand() * 0.72);
}
