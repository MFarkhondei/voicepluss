import { createFileRoute } from "@tanstack/react-router";

// Edge-compatible: no fs / child_process / ffmpeg.
// Client splits long audio into ≤10min WAV parts under 24 MiB.

const MAX_BYTES = 24 * 1024 * 1024;
const MAX_RETRIES = 4;
const TIMEOUT_MS = 180_000;

type Segment = { start: number; end: number; text: string };

async function callGroq(
  file: File | Blob,
  filename: string,
  apiKey: string,
  model: string,
): Promise<{ text: string; duration: number | null; segments: Segment[] }> {
  let lastError = "unknown";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const upstream = new FormData();
    upstream.append("file", file, filename);
    upstream.append("model", model);
    upstream.append("language", "fa");
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
        lastError = `status ${res.status}: ${detail.slice(0, 400)}`;
        // Don't retry hard client errors except rate limit
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new Error(lastError);
        }
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }

      const data = (await res.json()) as {
        text?: string;
        duration?: number;
        segments?: { start: number; end: number; text: string }[];
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
        })),
      };
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
    }
  }

  throw new Error(lastError);
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "کلید سرویس Groq تنظیم نشده است." },
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

        const model = String(form.get("model") || "whisper-large-v3");
        const filename = file.name || "audio.wav";

        try {
          const result = await callGroq(file, filename, apiKey, model);
          return Response.json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[transcribe]", message);
          return Response.json(
            { error: `خطای سرویس Groq: ${message.slice(0, 300)}` },
            { status: 502 },
          );
        }
      },
    },
  },
});
