import { createFileRoute } from "@tanstack/react-router";

// Edge-compatible: analyze transcript with free Groq chat models.

const MAX_CHARS = 48_000;
const TIMEOUT_MS = 90_000;
const MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `تو دستیار تحلیل متن فارسی هستی. فقط بر اساس متن داده‌شده پاسخ بده.
خروجی را دقیقاً با این ساختار و به فارسی بنویس:

## خلاصه
(۲ تا ۵ جمله خلاصه روان)

## نکات کلیدی
- نکته ۱
- نکته ۲
(حداکثر ۸ مورد)

## اقدامات پیشنهادی
- اقدام ۱
- اقدام ۲
(اگر موردی نبود بنویس: مورد خاصی یافت نشد.)

## موضوعات
کلمات یا موضوعات اصلی با کاما جدا شوند.

اگر متن خیلی کوتاه یا بی‌معنی بود، همین را کوتاه بگو. اغراق نکن و چیزی از خودت اضافه نکن.`;

export const Route = createFileRoute("/api/analyze")({
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

        let body: { text?: string };
        try {
          body = (await request.json()) as { text?: string };
        } catch {
          return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
        }

        const text = (body.text ?? "").trim();
        if (!text) {
          return Response.json({ error: "متنی برای تحلیل ارسال نشده است." }, { status: 400 });
        }
        if (text.length > MAX_CHARS) {
          return Response.json(
            { error: `متن خیلی طولانی است (حداکثر حدود ${MAX_CHARS} کاراکتر).` },
            { status: 400 },
          );
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL,
              temperature: 0.2,
              max_tokens: 2048,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                  role: "user",
                  content: `متن پیاده‌شده صوت را تحلیل کن:\n\n${text}`,
                },
              ],
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            console.error("[analyze]", res.status, detail.slice(0, 400));
            return Response.json(
              {
                error:
                  res.status === 429
                    ? "سرویس موقتاً شلوغ است. چند لحظه بعد دوباره تلاش کنید."
                    : `خطای سرویس تحلیل (${res.status})`,
              },
              { status: res.status === 429 ? 429 : 502 },
            );
          }

          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const analysis = data.choices?.[0]?.message?.content?.trim() ?? "";
          if (!analysis) {
            return Response.json({ error: "پاسخ خالی از سرویس تحلیل." }, { status: 502 });
          }

          return Response.json({ analysis, model: MODEL });
        } catch (err) {
          clearTimeout(timer);
          const isAbort = err instanceof Error && err.name === "AbortError";
          const message = isAbort
            ? "زمان تحلیل تمام شد."
            : err instanceof Error
              ? err.message
              : String(err);
          console.error("[analyze]", message);
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
