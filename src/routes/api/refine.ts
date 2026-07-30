import { createFileRoute } from "@tanstack/react-router";

/** بهبود متن: اصلاح املا/علائم + تفکیک گویندگان با مدل زبانی Groq */

const MODEL = "llama-3.3-70b-versatile";
const BATCH = 40;

type InSeg = { i: number; text: string };
type OutSeg = { i: number; text: string; speaker?: string | null };

function systemPrompt(language: string, diarize: boolean) {
  const isFa = language !== "en";
  const lang = isFa ? "Persian (Farsi)" : "English";
  const punct = isFa
    ? "Use correct Persian punctuation: ، . ؟ ! : ؛ «» — and ZWNJ (نیم‌فاصله) where needed (e.g. می‌شود، کتاب‌ها)."
    : "Use correct English punctuation and capitalization.";
  const spelling = isFa
    ? "Fix common Persian STT spelling errors (همزه، ی/ک عربی vs فارسی، فاصلهٔ اشتباه، تکرار حروف) without changing meaning."
    : "Fix obvious STT spelling mistakes without changing meaning.";
  return [
    `You clean up raw speech-to-text output in ${lang}.`,
    "For each input segment return the SAME segment index with corrected text.",
    punct,
    spelling,
    "NEVER translate, NEVER summarize, NEVER merge or split segments, NEVER invent new content words.",
    diarize
      ? 'Also infer the speaker of each segment from context and return a short stable label in "speaker" (e.g. "گوینده ۱", "گوینده ۲" for Persian, or "Speaker 1" for English). Keep the same label for the same person across segments.'
      : 'Set "speaker" to null.',
    'Reply with ONLY valid JSON: {"segments":[{"i":number,"text":string,"speaker":string|null}]}',
  ].join(" ");
}

function friendlyError(status: number, detail: string): string {
  const lower = detail.toLowerCase();
  if (
    status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("tokens per minute") ||
    lower.includes("tpm")
  ) {
    return "به علت محدودیت سرویس امکان اصلاح متن وجود ندارد. چند لحظه بعد دوباره تلاش کنید.";
  }
  if (status === 401 || status === 403) {
    return "دسترسی به سرویس بهبود متن ممکن نیست. کلید سرویس را بررسی کنید.";
  }
  if (status >= 500) {
    return "سرویس بهبود متن موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.";
  }
  return "خطا در بهبود متن. لطفاً دوباره تلاش کنید.";
}

async function callGroq(apiKey: string, batch: InSeg[], language: string, diarize: boolean): Promise<OutSeg[]> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(language, diarize) },
        { role: "user", content: JSON.stringify({ segments: batch }) },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(friendlyError(res.status, detail));
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { segments?: OutSeg[] };
  return Array.isArray(parsed.segments) ? parsed.segments : [];
}

export const Route = createFileRoute("/api/refine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) return Response.json({ error: "کلید سرویس Groq تنظیم نشده است." }, { status: 500 });

        let body: { segments?: InSeg[]; language?: string; diarize?: boolean };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
        }

        const segments = (body.segments ?? [])
          .filter((s) => typeof s?.i === "number" && typeof s?.text === "string")
          .map((s) => ({ i: s.i, text: s.text.trim() }))
          .filter((s) => s.text.length > 0);
        if (segments.length === 0) return Response.json({ error: "متنی برای بهبود ارسال نشده است." }, { status: 400 });

        const language = body.language === "en" ? "en" : "fa";
        // فقط وقتی کاربر صریحاً فعال کرده باشد
        const diarize = body.diarize === true;

        try {
          const out: OutSeg[] = [];
          for (let i = 0; i < segments.length; i += BATCH) {
            const batch = segments.slice(i, i + BATCH);
            const result = await callGroq(apiKey, batch, language, diarize);
            const byIndex = new Map(result.map((r) => [r.i, r]));
            for (const s of batch) {
              const r = byIndex.get(s.i);
              out.push({
                i: s.i,
                text: (r?.text || s.text).trim(),
                speaker: diarize && r?.speaker ? String(r.speaker).slice(0, 40) : null,
              });
            }
          }
          return Response.json({ segments: out });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[refine]", message);
          // اگر پیام از friendlyError آمده، همان را برگردان؛ در غیر این صورت پیام عمومی
          const isFriendly =
            message.includes("محدودیت سرویس") ||
            message.includes("دسترسی به سرویس") ||
            message.includes("موقتاً در دسترس") ||
            message.includes("دوباره تلاش");
          return Response.json(
            { error: isFriendly ? message : "خطا در بهبود متن. لطفاً دوباره تلاش کنید." },
            { status: 502 },
          );
        }
      },
    },
  },
});
