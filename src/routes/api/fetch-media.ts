import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 300 * 1024 * 1024;

function nameFromUrl(u: URL, contentType: string): string {
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
  if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  const ext = contentType.includes("mpeg") ? "mp3"
    : contentType.includes("wav") ? "wav"
    : contentType.includes("ogg") ? "ogg"
    : contentType.includes("webm") ? "webm"
    : contentType.includes("mp4") ? "mp4"
    : "audio";
  return `media.${ext}`;
}

export const Route = createFileRoute("/api/fetch-media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let url: URL;
        try {
          const body = (await request.json()) as { url?: string };
          url = new URL(String(body.url || "").trim());
        } catch {
          return Response.json({ error: "لینک نامعتبر است." }, { status: 400 });
        }

        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return Response.json({ error: "فقط لینک‌های http یا https پشتیبانی می‌شوند." }, { status: 400 });
        }
        if (/(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|aparat\.com)$/i.test(url.hostname)) {
          return Response.json(
            { error: "لینک صفحات ویدیویی (یوتیوب، اینستاگرام، آپارات و…) پشتیبانی نمی‌شود. لینک مستقیم فایل صوتی یا ویدیویی را وارد کنید." },
            { status: 400 },
          );
        }

        let upstream: Response;
        try {
          upstream = await fetch(url.toString(), {
            headers: { "user-agent": "Mozilla/5.0", accept: "*/*" },
            redirect: "follow",
          });
        } catch {
          return Response.json({ error: "دریافت فایل از این لینک ممکن نشد." }, { status: 502 });
        }

        if (!upstream.ok || !upstream.body) {
          return Response.json({ error: `سرور مقصد پاسخ داد: ${upstream.status}` }, { status: 502 });
        }

        const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
        if (contentType.startsWith("text/html")) {
          return Response.json(
            { error: "این لینک یک صفحه وب است، نه فایل صوتی/ویدیویی. لینک مستقیم فایل را وارد کنید." },
            { status: 400 },
          );
        }
        const len = Number(upstream.headers.get("content-length") || 0);
        if (len && len > MAX_BYTES) {
          return Response.json({ error: "حجم فایل بیش از حد مجاز است." }, { status: 413 });
        }

        const filename = nameFromUrl(url, contentType);
        return new Response(upstream.body, {
          headers: {
            "content-type": contentType || "application/octet-stream",
            "x-file-name": encodeURIComponent(filename),
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
