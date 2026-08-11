import { createFileRoute } from "@tanstack/react-router";

/** ترجمهٔ متن به فارسی با مدل‌های Groq */

const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"] as const;

const SYSTEM = [
  "You are a professional translator.",
  "Translate the user's text into natural, fluent Persian (Farsi).",
  "Keep the meaning exactly; do not summarize, explain, or add anything.",
  "If the text is already Persian, just return it with corrected spelling and punctuation.",
  "Reply with ONLY the translated text, no quotes and no extra commentary.",
].join(" ");

export const Route = createFileRoute("/api/translate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) return Response.json({ error: "کلید سرویس Groq تنظیم نشده است." }, { status: 500 });

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
        for (const model of MODELS) {
          try {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
            if (!res.ok) {
              lastStatus = res.status;
              continue;
            }
            const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
            const translation = data.choices?.[0]?.message?.content?.trim() ?? "";
            if (!translation) continue;
            return Response.json({ translation, model });
          } catch (err) {
            console.error("[translate]", err instanceof Error ? err.message : String(err));
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
