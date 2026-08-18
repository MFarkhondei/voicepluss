import { createFileRoute } from "@tanstack/react-router";

/** بهبود متن: اصلاح املا/علائم + تفکیک گویندگان
 * زنجیره مدل‌ها: اگر یکی محدود/خطا داد، بعدی امتحان می‌شود.
 */

/** مدل‌های Groq به‌ترتیب اولویت — سبک‌ترها معمولاً TPM بالاتر دارند */
const MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
] as const;

const BATCH = 28;

type InSeg = { i: number; text: string };
type OutSeg = { i: number; text: string; speaker?: string | null };

function systemPrompt(language: string, diarize: boolean) {
  const isFa = language === "fa";
  const isDe = language === "de";
  const lang = isFa ? "Persian (Farsi)" : isDe ? "German (Deutsch)" : "English";
  const punct = isFa
    ? "Use correct Persian punctuation: ، . ؟ ! : ؛ «» — and ZWNJ (نیم‌فاصله) where needed (e.g. می‌شود، کتاب‌ها)."
    : isDe
      ? "Use correct German punctuation, capitalization of nouns, and umlauts (ä, ö, ü, ß)."
      : "Use correct English punctuation and capitalization.";
  const spelling = isFa
    ? "Fix common Persian STT spelling errors (همزه، ی/ک عربی vs فارسی، فاصلهٔ اشتباه، تکرار حروف) without changing meaning."
    : isDe
      ? "Fix common German STT spelling errors (missing umlauts, ss/ß, compound words) without changing meaning."
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

function isRateLimit(status: number, detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("tokens per minute") ||
    lower.includes("tpm") ||
    lower.includes("too many requests")
  );
}

function friendlyError(status: number, detail: string): string {
  if (isRateLimit(status, detail)) {
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callModel(
  apiKey: string,
  model: string,
  batch: InSeg[],
  language: string,
  diarize: boolean,
): Promise<OutSeg[]> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
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
    const err = new Error(friendlyError(res.status, detail)) as Error & {
      status?: number;
      rateLimited?: boolean;
    };
    err.status = res.status;
    err.rateLimited = isRateLimit(res.status, detail);
    throw err;
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: { segments?: OutSeg[] };
  try {
    parsed = JSON.parse(raw) as { segments?: OutSeg[] };
  } catch {
    throw new Error("پاسخ نامعتبر از مدل بهبود متن");
  }
  return Array.isArray(parsed.segments) ? parsed.segments : [];
}

/** تلاش با چند مدل؛ در صورت rate-limit کوتاه صبر و مدل بعدی */
async function callWithFallback(
  apiKey: string,
  batch: InSeg[],
  language: string,
  diarize: boolean,
): Promise<OutSeg[]> {
  let lastError: Error | null = null;
  for (let m = 0; m < MODELS.length; m++) {
    const model = MODELS[m];
    try {
      return await callModel(apiKey, model, batch, language, diarize);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const rateLimited = (e as { rateLimited?: boolean })?.rateLimited === true;
      console.warn(`[refine] model ${model} failed:`, lastError.message);
      if (rateLimited && m < MODELS.length - 1) {
        await sleep(1500);
        continue;
      }
      // خطای غیر rate-limit هم با مدل بعدی امتحان می‌شود
      if (m < MODELS.length - 1) {
        await sleep(400);
        continue;
      }
    }
  }
  throw lastError ?? new Error("خطا در بهبود متن. لطفاً دوباره تلاش کنید.");
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

        const language = body.language === "en" ? "en" : body.language === "de" ? "de" : "fa";
        const diarize = body.diarize === true;

        try {
          const out: OutSeg[] = [];
          for (let i = 0; i < segments.length; i += BATCH) {
            const batch = segments.slice(i, i + BATCH);
            const result = await callWithFallback(apiKey, batch, language, diarize);
            const byIndex = new Map(result.map((r) => [r.i, r]));
            for (const s of batch) {
              const r = byIndex.get(s.i);
              out.push({
                i: s.i,
                text: (r?.text || s.text).trim(),
                speaker: diarize && r?.speaker ? String(r.speaker).slice(0, 40) : null,
              });
            }
            // فاصله کوتاه بین batchها برای کاهش فشار TPM
            if (i + BATCH < segments.length) await sleep(300);
          }
          return Response.json({ segments: out });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[refine]", message);
          const isFriendly =
            message.includes("محدودیت سرویس") ||
            message.includes("دسترسی به سرویس") ||
            message.includes("موقتاً در دسترس") ||
            message.includes("دوباره تلاش") ||
            message.includes("پاسخ نامعتبر");
          return Response.json(
            { error: isFriendly ? message : "خطا در بهبود متن. لطفاً دوباره تلاش کنید." },
            { status: 502 },
          );
        }
      },
    },
  },
});
