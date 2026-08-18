import { createFileRoute } from "@tanstack/react-router";

/** ترجمهٔ متن به فارسی — Groq با فالبک روی سرویس هوش مصنوعی Lovable */

const GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"] as const;
const FALLBACK_MODELS = ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"] as const;

const SYSTEM = [
  "You are a professional translator.",
  "Translate the user's text into natural, fluent Persian (Farsi).",
  "Keep the meaning exactly; do not summarize, explain, or add anything.",
  "If the text is already Persian, just return it with corrected spelling and punctuation.",
  "Reply with ONLY the translated text, no quotes and no extra commentary.",
].join(" ");

type ChatResult = { translation?: string; model?: string; status?: number };

async function chat(
  endpoint: string,
  apiKey: string,
  model: string,
  text: string,
): Promise<ChatResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) return { status: res.status };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const translation = data.choices?.[0]?.message?.content?.trim() ?? "";
    return translation ? { translation, model } : { status: 502 };
  } catch (err) {
    console.error("[translate]", err instanceof Error ? err.message : String(err));
    return { status: 0 };
  }
}

export const Route = createFileRoute("/api/translate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const groqKey = process.env.GROQ_API_KEY;
        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!groqKey && !lovableKey)
          return Response.json({ error: "سرویس ترجمه پیکربندی نشده است." }, { status: 500 });

        let body: { text?: string };
        try {
          body = (await request.json()) as { text?: string };
        } catch {
          return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
        }

        const text = (body.text ?? "").trim();
        if (!text) return Response.json({ error: "متنی برای ترجمه ارسال نشده است." }, { status: 400 });
        if (text.length > 8000) return Response.json({ error: "متن برای ترجمه طولانی است." }, { status: 400 });

        let lastStatus = 0;

        if (groqKey) {
          for (const model of GROQ_MODELS) {
            const r = await chat("https://api.groq.com/openai/v1/chat/completions", groqKey, model, text);
            if (r.translation) return Response.json({ translation: r.translation, model: r.model, provider: "groq" });
            lastStatus = r.status ?? lastStatus;
          }
        }

        if (lovableKey) {
          for (const model of FALLBACK_MODELS) {
            const r = await chat("https://ai.gateway.lovable.dev/v1/chat/completions", lovableKey, model, text);
            if (r.translation)
              return Response.json({ translation: r.translation, model: r.model, provider: "lovable" });
            lastStatus = r.status ?? lastStatus;
          }
        }

        return Response.json(
          {
            error:
              lastStatus === 429
                ? "سرویس ترجمه موقتاً شلوغ است. چند لحظه بعد دوباره تلاش کنید."
                : "ترجمه انجام نشد. لطفاً دوباره تلاش کنید.",
          },
          { status: lastStatus === 429 ? 429 : 502 },
        );
      },
    },
  },
});
