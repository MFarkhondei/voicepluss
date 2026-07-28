import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import ffmpegPath from "ffmpeg-static";

const MAX_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes per-part

function uniqueTmp(prefix = "transcribe") {
  return path.join(os.tmpdir(), `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`);
}

async function runFfmpeg(args: string[], cwd?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const p = require("child_process").spawn(ffmpegPath as string, args, { cwd });
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d: any) => (stdout += d.toString()));
    p.stderr?.on("data", (d: any) => (stderr += d.toString()));
    p.on("error", (err: any) => reject(err));
    p.on("close", (code: number) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function transcribePart(
  partPath: string,
  fname: string,
  apiKey: string,
  model: string,
  maxRetries = DEFAULT_MAX_RETRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  let lastErr: any = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`[transcribePart] attempt ${attempt + 1}/${maxRetries} for ${fname}`);
      const chunkBuf = fs.readFileSync(partPath);
      const upstream = new FormData();
      upstream.append("file", new Blob([chunkBuf]), fname);
      upstream.append("model", model);
      upstream.append("language", "fa");
      upstream.append("response_format", "verbose_json");
      upstream.append("temperature", "0");

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const started = Date.now();
        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: upstream as any,
          signal: controller.signal,
        });
        const took = Date.now() - started;
        clearTimeout(id);

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.warn(`[transcribePart] non-ok response for ${fname}: ${res.status} (${took}ms) - ${detail.slice(0,500)}`);
          lastErr = new Error(`status ${res.status}: ${detail.slice(0, 500)}`);
          if (res.status >= 400 && res.status < 500) break;
          const backoff = 2000 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        const data = (await res.json()) as {
          text?: string;
          duration?: number;
          segments?: { start: number; end: number; text: string }[];
        };

        console.log(`[transcribePart] success for ${fname} (${took}ms)`);
        return { success: true, data };
      } finally {
        try { clearTimeout(id); } catch {};
      }
    } catch (err) {
      console.warn(`[transcribePart] error for ${fname} on attempt ${attempt + 1}:`, String(err));
      lastErr = err;
      const backoff = 2000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
  }
  console.error(`[transcribePart] failed after ${maxRetries} attempts for ${fname}:`, String(lastErr));
  return { success: false, error: String(lastErr) };
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
        } catch (e) {
          console.error('[transcribe] invalid formData', String(e));
          return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
        }

        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) {
          return Response.json({ error: "فایل صوتی ارسال نشده است." }, { status: 400 });
        }

        const model = String(form.get("model") || "whisper-large-v3");
        console.log(`[transcribe] incoming file=${String(file.name)} size=${file.size} model=${model}`);

        if (file.size <= MAX_BYTES) {
          // Write to temp and reuse the same retry helper as multi-part path
          const tmpSingle = uniqueTmp("single-") + (path.extname(file.name || "") || ".wav");
          try {
            const buf = Buffer.from(await file.arrayBuffer());
            fs.writeFileSync(tmpSingle, buf);
            const resPart = await transcribePart(
              tmpSingle,
              file.name || "recording.wav",
              apiKey,
              model,
              DEFAULT_MAX_RETRIES,
              DEFAULT_TIMEOUT_MS,
            );
            if (!resPart.success) {
              return Response.json(
                { error: `خطای سرویس Groq: ${resPart.error}` },
                { status: 502 },
              );
            }
            const data = resPart.data as {
              text?: string;
              duration?: number;
              segments?: { start: number; end: number; text: string }[];
            };
            const textFromSegments = (data.segments ?? []).map((s: any) => s.text.trim()).join(" ").trim();
            const finalText = (data.text?.trim() || textFromSegments) ?? "";
            return Response.json({
              text: finalText,
              duration: data.duration ?? null,
              segments:
                data.segments?.map((s: any) => ({
                  start: s.start,
                  end: s.end,
                  text: s.text.trim(),
                })) ?? [],
            });
          } finally {
            try { fs.rmSync(tmpSingle, { force: true }); } catch {}
          }
        }

        if (!ffmpegPath) {
          console.error('[transcribe] ffmpeg not available');
          return Response.json(
            { error: "فایل بیش از حد بزرگ است و ffmpeg برای تقسیم وجود ندارد. لطفا فایل را کوچکتر کنید." },
            { status: 400 },
          );
        }

        const tmpIn = (uniqueTmp("in-") + path.extname(file.name || "")) || "";
        try {
          const buf = Buffer.from(await file.arrayBuffer());
          fs.writeFileSync(tmpIn, buf);
          const stat = fs.statSync(tmpIn);
          console.log(`[transcribe] wrote tmp file ${tmpIn} (${stat.size} bytes)`);
        } catch (err) {
          console.error("[transcribe] failed to write temp input", err);
          return Response.json({ error: "خطا در ذخیره موقت فایل." }, { status: 500 });
        }

        console.log(`[transcribe] probing duration via ffmpeg: ${ffmpegPath} -i ${tmpIn}`);
        const probe = spawnSync(ffmpegPath as string, ["-i", tmpIn]);
        const probeStderr = String(probe.stderr ?? "");
        console.log(`[transcribe] ffmpeg probe stderr (truncated): ${probeStderr.slice(0, 1000)}`);
        const durationMatch = probeStderr.match(/Duration:\s(\d+):(\d+):(\d+\.\d+)/);
        let durationSeconds = 0;
        if (durationMatch) {
          const h = Number(durationMatch[1]);
          const m = Number(durationMatch[2]);
          const s = Number(durationMatch[3]);
          durationSeconds = h * 3600 + m * 60 + s;
        } else {
          durationSeconds = Math.max(1, Math.floor(Buffer.byteLength(fs.readFileSync(tmpIn)) / 32000));
          console.log(`[transcribe] probe failed, estimated durationSeconds=${durationSeconds}`);
        }

        const partsCount = Math.max(1, Math.ceil(file.size / MAX_BYTES));
        const partDuration = Math.max(1, Math.ceil(durationSeconds / partsCount));
        console.log(`[transcribe] partsCount=${partsCount}, partDuration=${partDuration}s`);

        const tmpDir = uniqueTmp("parts-") + ".d";
        fs.mkdirSync(tmpDir, { recursive: true });

        const ext = path.extname(file.name) || ".wav";
        const outPattern = path.join(tmpDir, `part-%03d${ext}`);

        const ffArgs = ["-i", tmpIn, "-f", "segment", "-segment_time", String(partDuration), "-c", "copy", outPattern];
        console.log(`[transcribe] running ffmpeg split: ${ffArgs.join(" ")}`);
        const runRes = await runFfmpeg(ffArgs);
        console.log(`[transcribe] ffmpeg split exit=${runRes.code} stderr (truncated): ${runRes.stderr.slice(0,1000)}`);
        if (runRes.code !== 0) {
          console.warn("[transcribe] ffmpeg split failed, attempting re-encode and split", runRes.stderr.slice(0,1000));
          const reEncoded = tmpIn + ".wav";
          console.log(`[transcribe] re-encoding to WAV: -i ${tmpIn} -ar 16000 -ac 1 -c:a pcm_s16le ${reEncoded}`);
          const reEnc = await runFfmpeg(["-i", tmpIn, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", reEncoded]);
          console.log(`[transcribe] re-encode exit=${reEnc.code} stderr (truncated): ${reEnc.stderr.slice(0,1000)}`);
          if (reEnc.code !== 0) {
            console.error("[transcribe] ffmpeg re-encode failed", reEnc.stderr);
            return Response.json({ error: "خطا در تقسیم فایل با ffmpeg." }, { status: 500 });
          }
          const outPattern2 = path.join(tmpDir, `part-%03d.wav`);
          const split2 = await runFfmpeg(["-i", reEncoded, "-f", "segment", "-segment_time", String(partDuration), "-c", "copy", outPattern2]);
          if (split2.code !== 0) {
            console.error("ffmpeg split after re-encode failed", split2.stderr);
            return Response.json({ error: "خطا در تقسیم فایل با ffmpeg." }, { status: 500 });
          }
        }

        const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("part-")).sort();
        console.log(`[transcribe] found ${files.length} parts`);
        if (files.length === 0) {
          try { fs.rmSync(tmpIn, { force: true }); } catch {};
          return Response.json({ error: "بخش‌بندی فایل ناموفق بود." }, { status: 500 });
        }

        const allSegments: { start: number; end: number; text: string }[] = [];
        let combinedText = "";
        const failedParts: { part: string; error: string }[] = [];

        for (let i = 0; i < files.length; i++) {
          const fname = files[i];
          const partPath = path.join(tmpDir, fname);

          console.log(`[transcribe] transcribing part ${i + 1}/${files.length}: ${fname}`);
          const resPart = await transcribePart(partPath, fname, apiKey, model, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS);
          if (!resPart.success) {
            failedParts.push({ part: fname, error: resPart.error });
            console.warn(`[transcribe] part failed: ${fname} -> ${resPart.error}`);
            continue;
          }

          const data = resPart.data as {
            text?: string;
            duration?: number;
            segments?: { start: number; end: number; text: string }[];
          };

          const offset = i * partDuration;

          const textFromSegments = (data.segments ?? []).map((s) => s.text.trim()).join(" ").trim();
          const partText = (data.text?.trim() || textFromSegments) ?? "";
          if (combinedText) combinedText += " ";
          combinedText += partText;

          const segs = (data.segments ?? []).map((s) => ({ start: s.start + offset, end: s.end + offset, text: s.text.trim() }));
          allSegments.push(...segs);
        }

        try {
          fs.rmSync(tmpIn, { force: true });
        } catch {}
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}

        const result: any = { text: combinedText, duration: null, segments: allSegments };
        if (failedParts.length > 0) {
          result.partial = true;
          result.failed = failedParts;
        }

        console.log(`[transcribe] finished. parts=${files.length} failed=${failedParts.length}`);
        return Response.json(result);
      },
    },
  },
});
