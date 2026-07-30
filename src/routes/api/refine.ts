import { createFileRoute } from "@tanstack/react-router";

/** بهبود متن: نقطه‌گذاری خودکار + تفکیک گویندگان با مدل زبانی Groq */

const MODEL = "llama-3.3-70b-versatile";
const BATCH = 40;

type InSeg = { i: number; text: string };
type OutSeg = { i: number; text: string; speaker?: string | null };

function systemPrompt(language: string, diarize: boolean) {
  const lang = language === "en" ? "English" : "Persian (Farsi)";
  return [
    `You clean up raw speech-to-text output in ${lang}.`,
    "For each input segment return the SAME segment index with corrected text.",
    "Rules: add correct punctuation (، . ؟ ! : «») and capitalization, fix obvious spacing/half-space issues,",
    "NEVER translate, NEVER summarize, NEVER merge or split segments, NEVER add or remove content words.",
    diarize
      ? 'Also infer the speaker of each segment from context and return a short stable label in "speaker" (e.g. "گوینده ۱", "گوینده ۲"). Keep the same label for the same person across segments.'
      : 'Set "speaker" to null.',
    'Reply with ONLY valid JSON: {"segments":[{"i":number,"text":string,"speaker":string|null}]}',
  ].join(" ");
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
    throw new Error(`status ${res.status}: ${detail.slice(0, 300)}`);
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
        const diarize = body.diarize !== false;

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
                speaker: r?.speaker ? String(r.speaker).slice(0, 40) : null,
              });
            }
          }
          return Response.json({ segments: out });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[refine]", message);
          return Response.json({ error: `خطای بهبود متن: ${message.slice(0, 300)}` }, { status: 502 });
        }
      },
    },
  },
});
