import { createFileRoute } from "@tanstack/react-router";

// Edge-compatible: no fs / child_process / ffmpeg.
// Client splits long audio into WAV parts under 24 MiB.

const MAX_BYTES = 24 * 1024 * 1024;
const MAX_RETRIES = 3;
const TIMEOUT_MS = 240_000;

/** مدل‌های Whisper به‌ترتیب اولویت — در صورت 403 مدل بعدی امتحان می‌شود */
const MODELS = ["whisper-large-v3", "whisper-large-v3-turbo"] as const;

type Segment = {
  start: number;
  end: number;
  text: string;
  /** 0..1 derived from Whisper avg_logprob; higher = more confident */
  confidence?: number | null;
};

function normalizeLanguage(raw: unknown): string {
  const v = String(raw ?? "fa").trim().toLowerCase();
  if (v === "en" || v === "english" || v === "انگلیسی") return "en";
  return "fa";
}

/** Convert avg_logprob (≤0) to a 0..1 confidence score. */
function logprobToConfidence(avgLogprob: unknown): number | null {
  if (typeof avgLogprob !== "number" || !Number.isFinite(avgLogprob)) return null;
  const conf = Math.exp(Math.min(0, avgLogprob));
  return Math.max(0, Math.min(1, conf));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseGroqDetail(detail: string): string {
  try {
    const j = JSON.parse(detail) as { error?: { message?: string; code?: string } };
    return j?.error?.message || detail;
  } catch {
    return detail;
  }
}

function friendlyTranscribeError(status: number, detail: string): string {
  const msg = parseGroqDetail(detail).toLowerCase();
  if (status === 401 || msg.includes("invalid api key") || msg.includes("authentication")) {
    return "کلید سرویس Groq نامعتبر است. در تنظیمات پروژه (GROQ_API_KEY) کلید را بررسی کنید.";
  }
  if (
    status === 403 ||
    msg.includes("forbidden") ||
    msg.includes("permission") ||
    msg.includes("blocked") ||
    msg.includes("not allowed")
  ) {
    if (msg.includes("model") && (msg.includes("block") || msg.includes("permission"))) {
      return "دسترسی به مدل تبدیل صوت در حساب Groq محدود شده است. در console.groq.com بخش Limits/Permissions مدل whisper را فعال کنید.";
    }
    return "دسترسی به سرویس تبدیل صوت مجاز نیست (۴۰۳). کلید API، محدودیت مدل در کنسول Groq، یا وضعیت حساب را بررسی کنید.";
  }
  if (status === 429 || msg.includes("rate limit")) {
    return "محدودیت نرخ درخواست Groq. چند لحظه صبر کنید و دوباره تلاش کنید.";
  }
  if (status === 413) {
    return "حجم فایل برای سرویس خیلی بزرگ است. فایل کوتاه‌تری امتحان کنید.";
  }
  if (status >= 500) {
    return "سرویس تبدیل صوت موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.";
  }
  const short = parseGroqDetail(detail).slice(0, 180);
  return short ? `خطای تبدیل صوت: ${short}` : "خطا در تبدیل صوت. لطفاً دوباره تلاش کنید.";
}

async function callGroqOnce(
  file: File | Blob,
  filename: string,
  apiKey: string,
  model: string,
  language: string,
): Promise<{ text: string; duration: number | null; segments: Segment[] }> {
  const upstream = new FormData();
  upstream.append("file", file, filename);
  upstream.append("model", model);
  upstream.append("language", language);
  upstream.append("response_format", "verbose_json");
  upstream.append("temperature", "0");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(friendlyTranscribeError(res.status, detail)) as Error & {
        status?: number;
        retryable?: boolean;
      };
      err.status = res.status;
      // 429 و 5xx قابل تلاش مجدد
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    }

    const data = (await res.json()) as {
      text?: string;
      duration?: number;
      segments?: {
        start: number;
        end: number;
        text: string;
        avg_logprob?: number;
      }[];
    };

    const textFromSegments = (data.segments ?? [])
      .map((s) => (s.text ?? "").trim())
      .join(" ")
      .trim();
    const finalText = (data.text?.trim() || textFromSegments) ?? "";

    return {
      text: finalText,
      duration: data.duration ?? null,
      segments: (data.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: (s.text ?? "").trim(),
        confidence: logprobToConfidence(s.avg_logprob),
      })),
    };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("زمان پردازش بخش تمام شد. دوباره تلاش کنید.");
    }
    throw err;
  }
}

async function callGroq(
  file: File | Blob,
  filename: string,
  apiKey: string,
  preferredModel: string,
  language: string,
): Promise<{ text: string; duration: number | null; segments: Segment[] }> {
  // preferred اول، سپس بقیهٔ MODELS بدون تکرار
  const models = [
    preferredModel,
    ...MODELS.filter((m) => m !== preferredModel),
  ];

  let lastError: Error | null = null;

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await callGroqOnce(file, filename, apiKey, model, language);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = (err as { status?: number })?.status;
        const retryable = (err as { retryable?: boolean })?.retryable === true;

        // 403/401 روی این مدل → مدل بعدی
        if (status === 403 || status === 401) {
          console.warn(`[transcribe] model ${model} status ${status}, trying next…`);
          break;
        }

        if (retryable && attempt < MAX_RETRIES - 1) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }

        // خطای غیرقابل‌بازیابی روی این مدل → مدل بعدی فقط برای 5xx
        if (status != null && status >= 500 && model !== models[models.length - 1]) {
          break;
        }

        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("خطا در تبدیل صوت. لطفاً دوباره تلاش کنید.");
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = (process.env.GROQ_API_KEY || "").trim();
        if (!apiKey) {
          return Response.json(
            { error: "کلید سرویس Groq تنظیم نشده است. متغیر GROQ_API_KEY را در تنظیمات پروژه قرار دهید." },
            { status: 500 },
          );
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
        }

        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) {
          return Response.json({ error: "فایل صوتی ارسال نشده است." }, { status: 400 });
        }

        if (file.size > MAX_BYTES) {
          return Response.json(
            {
              error:
                "فایل بزرگ‌تر از ۲۴ مگابایت است. لطفاً از نسخهٔ جدید فرانت استفاده کنید تا خودکار تقسیم شود.",
            },
            { status: 400 },
          );
        }

        const model = String(form.get("model") || "whisper-large-v3").trim() || "whisper-large-v3";
        const language = normalizeLanguage(form.get("language"));
        const filename = file.name || "audio.wav";

        try {
          const result = await callGroq(file, filename, apiKey, model, language);
          return Response.json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[transcribe]", message);
          // پیام از قبل فارسی/دوستانه است
          return Response.json({ error: message.slice(0, 400) }, { status: 502 });
        }
      },
    },
  },
});
