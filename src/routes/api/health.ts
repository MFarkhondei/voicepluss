import { createFileRoute } from "@tanstack/react-router";

/** تست سلامت سرویس Groq با ارسال یک نمونهٔ صوتی کوتاه */

const MODEL = "whisper-large-v3-turbo";

/** ساخت یک WAV کوتاه (۰٫۵ ثانیه، ۱۶ کیلوهرتز مونو) با نویز بسیار ضعیف */
function makeSampleWav(): ArrayBuffer {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * 0.5);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const v = Math.sin(2 * Math.PI * 220 * t) * 0.05;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true);
  }
  return buffer;
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const apiKey = (process.env.GROQ_API_KEY || "").trim();
        if (!apiKey) {
          return Response.json(
            { ok: false, status: "error", message: "کلید سرویس Groq تنظیم نشده است." },
            { status: 200 },
          );
        }

        const started = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const form = new FormData();
          form.append("file", new Blob([makeSampleWav()], { type: "audio/wav" }), "sample.wav");
          form.append("model", MODEL);
          form.append("language", "fa");
          form.append("response_format", "json");
          form.append("temperature", "0");

          const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: controller.signal,
          });
          clearTimeout(timer);
          const latency = Date.now() - started;

          if (res.ok) {
            await res.json().catch(() => ({}));
            return Response.json({ ok: true, status: "ok", latency, model: MODEL, message: "سرویس Groq فعال است" });
          }

          const detail = await res.text().catch(() => "");
          let message = "سرویس تبدیل صوت در دسترس نیست";
          if (res.status === 401) message = "کلید Groq نامعتبر است";
          else if (res.status === 403) message = "دسترسی مدل در حساب Groq محدود است";
          else if (res.status === 429) message = "محدودیت نرخ درخواست Groq";
          else if (res.status >= 500) message = "سرویس Groq موقتاً در دسترس نیست";
          console.error("[health]", res.status, detail.slice(0, 200));
          return Response.json({ ok: false, status: "error", latency, message }, { status: 200 });
        } catch (err) {
          clearTimeout(timer);
          const aborted = err instanceof DOMException && err.name === "AbortError";
          return Response.json(
            {
              ok: false,
              status: "error",
              message: aborted ? "زمان تست سرویس تمام شد" : "اتصال به سرویس Groq برقرار نشد",
            },
            { status: 200 },
          );
        }
      },
    },
  },
});
