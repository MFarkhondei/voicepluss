import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync, spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";

const MAX_BYTES = 24 * 1024 * 1024;

function uniqueTmp(prefix = "transcribe") {
  return path.join(os.tmpdir(), `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`);
}

async function runFfmpeg(args: string[], cwd?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const p = spawn(ffmpegPath as string, args, { cwd });
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d) => (stdout += d.toString()));
    p.stderr?.on("data", (d) => (stderr += d.toString()));
    p.on("error", (err) => reject(err));
    p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
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

        const model = String(form.get("model") || "whisper-large-v3");

        // If file fits under the limit, just forward it to Groq as before.
        if (file.size <= MAX_BYTES) {
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

          const textFromSegments = (data.segments ?? []).map((s) => s.text.trim()).join(" ").trim();
          const finalText = (data.text?.trim() || textFromSegments) ?? "";

          return Response.json({
            text: finalText,
            duration: data.duration ?? null,
            segments:
              data.segments?.map((s) => ({
                start: s.start,
                end: s.end,
                text: s.text.trim(),
              })) ?? [],
          });
        }

        // If file is too large, try to split it with ffmpeg, transcribe parts and merge results.
        if (!ffmpegPath) {
          return Response.json(
            { error: "فایل بیش از حد بزرگ است و ffmpeg برای تقسیم وجود ندارد. لطفا فایل را کوچکتر کنید." },
            { status: 400 },
          );
        }

        // write uploaded file to temp
        const tmpIn = uniqueTmp("in-") + path.extname(file.name || "") || "";
        try {
          const buf = Buffer.from(await file.arrayBuffer());
          fs.writeFileSync(tmpIn, buf);
        } catch (err) {
          console.error("failed to write temp input", err);
          return Response.json({ error: "خطا در ذخیره موقت فایل." }, { status: 500 });
        }

        // get duration by parsing ffmpeg -i output
        const probe = spawnSync(ffmpegPath as string, ["-i", tmpIn]);
        const probeStderr = String(probe.stderr ?? "");
        const durationMatch = probeStderr.match(/Duration:\s(\d+):(\d+):(\d+\.\d+)/);
        let durationSeconds = 0;
        if (durationMatch) {
          const h = Number(durationMatch[1]);
          const m = Number(durationMatch[2]);
          const s = Number(durationMatch[3]);
          durationSeconds = h * 3600 + m * 60 + s;
        } else {
          // Fallback: estimate based on size by assuming worst-case 16-bit PCM 16kHz mono
          // 32000 bytes/sec
          durationSeconds = Math.max(1, Math.floor(Buffer.byteLength(fs.readFileSync(tmpIn)) / 32000));
        }

        const partsCount = Math.ceil(file.size / MAX_BYTES);
        const partDuration = Math.max(1, Math.ceil(durationSeconds / partsCount));

        const tmpDir = uniqueTmp("parts-") + ".d";
        fs.mkdirSync(tmpDir, { recursive: true });

        const ext = path.extname(file.name) || ".wav";
        const outPattern = path.join(tmpDir, `part-%03d${ext}`);

        // run ffmpeg to split into segments of partDuration seconds
        const ffArgs = ["-i", tmpIn, "-f", "segment", "-segment_time", String(partDuration), "-c", "copy", outPattern];
        const runRes = await runFfmpeg(ffArgs);
        if (runRes.code !== 0) {
          console.error("ffmpeg split failed", runRes.stderr);
          // attempt a re-encode split as fallback (re-encode to WAV then split)
          const reEncoded = tmpIn + ".wav";
          const reEnc = await runFfmpeg(["-i", tmpIn, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", reEncoded]);
          if (reEnc.code !== 0) {
            console.error("ffmpeg re-encode failed", reEnc.stderr);
            return Response.json({ error: "خطا در تقسیم فایل با ffmpeg." }, { status: 500 });
          }
          // try splitting the re-encoded WAV
          const outPattern2 = path.join(tmpDir, `part-%03d.wav`);
          const split2 = await runFfmpeg(["-i", reEncoded, "-f", "segment", "-segment_time", String(partDuration), "-c", "copy", outPattern2]);
          if (split2.code !== 0) {
            console.error("ffmpeg split after re-encode failed", split2.stderr);
            return Response.json({ error: "خطا در تقسیم فایل با ffmpeg." }, { status: 500 });
          }
        }

        // read parts
        const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("part-")).sort();
        if (files.length === 0) {
          return Response.json({ error: "بخش‌بندی فایل ناموفق بود." }, { status: 500 });
        }

        const allSegments: { start: number; end: number; text: string }[] = [];
        let combinedText = "";

        for (let i = 0; i < files.length; i++) {
          const fname = files[i];
          const partPath = path.join(tmpDir, fname);
          const chunkBuf = fs.readFileSync(partPath);

          const upstream = new FormData();
          upstream.append("file", new Blob([chunkBuf]), fname);
          upstream.append("model", model);
          upstream.append("language", "fa");
          upstream.append("response_format", "verbose_json");
          upstream.append("temperature", "0");

          const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: upstream as any,
          });

          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            // clean up
            try { fs.rmSync(tmpIn, { force: true }); } catch {};
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {};
            return Response.json({ error: `خطای سرویس Groq (${res.status})`, detail: detail.slice(0, 500) }, { status: res.status });
          }

          const data = (await res.json()) as {
            text?: string;
            duration?: number;
            segments?: { start: number; end: number; text: string }[];
          };

          // compute offset for this part
          const offset = i * partDuration;

          const textFromSegments = (data.segments ?? []).map((s) => s.text.trim()).join(" ").trim();
          const partText = (data.text?.trim() || textFromSegments) ?? "";
          if (combinedText) combinedText += " ";
          combinedText += partText;

          const segs = (data.segments ?? []).map((s) => ({ start: s.start + offset, end: s.end + offset, text: s.text.trim() }));
          allSegments.push(...segs);
        }

        // cleanup
        try {
          fs.rmSync(tmpIn, { force: true });
        } catch {}
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}

        return Response.json({ text: combinedText, duration: null, segments: allSegments });
      },
    },
  },
});
