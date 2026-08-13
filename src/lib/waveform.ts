/** استخراج پیک‌های دامنهٔ صوت برای رسم waveform.
 * برای فایل‌های بزرگ دیکود کامل انجام نمی‌شود تا تب کروم کرش نکند.
 * دیکود واقعی (decodeAudioData) مدت زمان دقیق فایل را هم به‌دست می‌دهد —
 * بدون نیاز به seek کردن روی خود عنصر <audio> پخش (که در فایرفاکس مشکل‌ساز است). */

/** بالای این حجم: فقط الگوی تقریبی (بدون decodeAudioData) */
const MAX_DECODE_BYTES = 6 * 1024 * 1024;

export type PeaksResult = { peaks: number[]; duration: number };

export async function extractPeaks(blob: Blob, barCount = 120): Promise<PeaksResult> {
  // فایل بزرگ / ویدیو: دیکود دوباره = کرش حافظه (Aw, Snap!)
  if (blob.size > MAX_DECODE_BYTES) {
    return { peaks: fallbackPeaks(blob.size, barCount), duration: 0 };
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new AudioContext();
    try {
      // بدون slice — decodeAudioData بافر را منتقل می‌کند
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      const channels = decoded.numberOfChannels;
      const length = decoded.length;
      const duration = Number.isFinite(decoded.duration) && decoded.duration > 0 ? decoded.duration : 0;
      if (length === 0) return { peaks: fallbackPeaks(blob.size, barCount), duration };

      const bucketSize = Math.max(1, Math.floor(length / barCount));
      const rawPeaks: number[] = [];
      for (let i = 0; i < barCount; i++) {
        const start = i * bucketSize;
        const end = Math.min(length, start + bucketSize);
        const step = Math.max(1, Math.floor((end - start) / 48));
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
      return { peaks: rawPeaks.map((p) => Math.min(1, p / peakMax)), duration };
    } finally {
      void ctx.close();
    }
  } catch {
    return { peaks: fallbackPeaks(blob.size, barCount), duration: 0 };
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
