/** استخراج پیک‌های دامنهٔ صوت برای رسم waveform. در صورت شکست دیکود، الگوی
 * ثابتِ مبتنی بر حجم فایل برمی‌گردد تا UI هرگز خالی نماند. */

export async function extractPeaks(blob: Blob, barCount = 120): Promise<number[]> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new AudioContext();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const channels = decoded.numberOfChannels;
      const length = decoded.length;
      if (length === 0) return fallbackPeaks(blob.size, barCount);

      const merged = new Float32Array(length);
      for (let c = 0; c < channels; c++) {
        const data = decoded.getChannelData(c);
        for (let i = 0; i < length; i++) merged[i] += data[i] / channels;
      }

      const bucketSize = Math.max(1, Math.floor(length / barCount));
      const rawPeaks: number[] = [];
      for (let i = 0; i < barCount; i++) {
        const start = i * bucketSize;
        const end = Math.min(length, start + bucketSize);
        let max = 0;
        for (let j = start; j < end; j++) {
          const v = Math.abs(merged[j]);
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

/** الگوی شبه‌تصادفیِ پایدار (seed = حجم فایل) برای زمانی که دیکود ممکن نیست. */
function fallbackPeaks(sizeBytes: number, barCount: number): number[] {
  let seed = (sizeBytes % 100000) || 12345;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: barCount }, () => 0.22 + rand() * 0.72);
}
