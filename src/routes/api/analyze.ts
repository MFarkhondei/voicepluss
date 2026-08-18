import { createFileRoute } from "@tanstack/react-router";

// Edge-compatible: analyze transcript with free Groq chat models.
// mode=quick → short structured summary
// mode=full  → deep multi-section analyst report

const MAX_CHARS = 48_000;
const TIMEOUT_MS = 120_000;
const MODEL = "openai/gpt-oss-120b";

const QUICK_PROMPT = `تو دستیار تحلیل متن فارسی هستی. فقط بر اساس متن داده‌شده پاسخ بده.
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

const FULL_PROMPT = `تو یک تحلیل‌گر حرفه‌ای متن فارسی هستی. مثل یک گزارش‌نویس دقیق، کل متن را بخش‌به‌بخش بررسی کن و فقط بر اساس محتوای داده‌شده بنویس. چیزی از خودت اختراع نکن.

گزارش را به فارسی و با همین ساختار کامل بنویس:

## خلاصه اجرایی
خلاصهٔ کوتاه و جامع از کل متن (۳ تا ۶ جمله).

## ساختار و بخش‌بندی محتوا
متن را به بخش‌های منطقی تقسیم کن و برای هر بخش عنوان کوتاه و یک پاراگراف توضیح بده (چه گفته شده).

## نکات کلیدی
فهرست مهم‌ترین نکات (حداکثر ۱۲ مورد).

## جزئیات مهم
اعداد، نام‌ها، تاریخ‌ها، تصمیم‌ها، تعهدات یا ادعاهای مشخصی که در متن آمده را فهرست کن. اگر نبود بنویس: مورد مشخصی یافت نشد.

## لحن و فضای گفتگو
لحن کلی (رسمی/غیررسمی، موافق/منتقد، آرام/تنش‌دار و …) را در ۲–۴ جمله توضیح بده.

## نقاط قوت محتوا
چه بخش‌هایی شفاف، مستند یا مفید است.

## ابهامات و کمبودها
چه چیزهایی ناقص، مبهم یا نیازمند توضیح بیشتر است.

## اقدامات و پیشنهادها
کارهای عملی پیشنهادی بر اساس متن (یا بنویس: مورد خاصی یافت نشد).

## جمع‌بندی نهایی
یک پاراگراف جمع‌بندی و ارزیابی کلی.

اگر متن خیلی کوتاه بود، همان را بگو و فقط بخش‌های قابل‌اجرا را پر کن.`;

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

        let body: { text?: string; mode?: string };
        try {
          body = (await request.json()) as { text?: string; mode?: string };
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

        const mode = body.mode === "full" ? "full" : "quick";
        const systemPrompt = mode === "full" ? FULL_PROMPT : QUICK_PROMPT;
        const maxTokens = mode === "full" ? 4096 : 2048;
        const userLead =
          mode === "full"
            ? "به‌عنوان تحلیل‌گر، گزارش کامل و بخش‌به‌بخش از این متن پیاده‌شده تهیه کن:"
            : "متن پیاده‌شده صوت را تحلیل کن:";

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
              temperature: mode === "full" ? 0.25 : 0.2,
              max_tokens: maxTokens,
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: `${userLead}\n\n${text}`,
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

          return Response.json({ analysis, model: MODEL, mode });
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
