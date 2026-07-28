import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 24 * 1024 * 1024;

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
            { error: "حجم فایل بیش از حد مجاز (۲۴ مگابایت) است." },
            { status: 400 },
          );
        }

        const model = String(form.get("model") || "whisper-large-v3");
        const upstream = new FormData();
        upstream.append("file", file, file.name || "recording.wav");
        upstream.append("model", model);
        upstream.append("language", "fa");
        upstream.append("response_format", "verbose_json");
        upstream.append("temperature", "0");

        const res = await fetch(
          "https://api.groq.com/openai/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: upstream,
          },
        );

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          return Response.json(
            { error: `خطای سرویس Groq (${res.status})`, detail: detail.slice(0, 500) },
            { status: res.status },
          );
        }

        const data = (await res.json()) as {
          text?: string;
          duration?: number;
          segments?: { start: number; end: number; text: string }[];
        };

        return Response.json({
          text: data.text?.trim() ?? "",
          duration: data.duration ?? null,
          segments:
            data.segments?.map((s) => ({
              start: s.start,
              end: s.end,
              text: s.text.trim(),
            })) ?? [],
        });
      },
    },
  },
});
