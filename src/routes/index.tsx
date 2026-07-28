import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Mic, Square, Upload, Copy, Check, Loader2, Trash2, Download, Sparkles, FileSearch } from "lucide-react";
import { encodeWav } from "@/lib/wav";
import { toSrt, toTxt, downloadText } from "@/lib/subtitles";
import { prepareAudioForTranscription, DEFAULT_PART_MINUTES, clampPartMinutes } from "@/lib/splitAudio";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VoicePluss | تبدیل صوت به متن فارسی" },
      {
        name: "description",
        content:
          "VoicePluss — ضبط یا آپلود فایل صوتی و دریافت متن فارسی دقیق با موتور Whisper روی زیرساخت Groq.",
      },
      { property: "og:title", content: "VoicePluss | تبدیل صوت به متن فارسی" },
      {
        property: "og:description",
        content:
          "VoicePluss — ضبط یا آپلود فایل صوتی و دریافت متن فارسی دقیق با موتور Whisper روی زیرساخت Groq.",
      },
    ],
  }),
  component: Index,
});

type Segment = { start: number; end: number; text: string };
type AnalysisMode = "quick" | "full";

const MODELS = [
  { id: "whisper-large-v3", label: "دقت بالا (whisper-large-v3)" },
  { id: "whisper-large-v3-turbo", label: "سریع (whisper-large-v3-turbo)" },
];

const CLIENT_TIMEOUT_MS = 240_000; // up to ~4 min per part (covers longer chunks)
const CLIENT_RETRIES = 4;

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function transcribeOne(
  blob: Blob,
  name: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ text: string; segments: Segment[]; duration: number | null }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < CLIENT_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("عملیات لغو شد.");

    const form = new FormData();
    form.append("file", blob, namen    form.append("model", model);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error(`پاسخ نامعتبر از سرور (کد ${res.status})`);
      }

      if (!res.ok) {
        const msg = data?.error || `خطا در پردازش فایل صوتی (${res.status})`;
        if (res.status >= 500 || res.status === 429 || res.status === 408) {
          lastError = new Error(msg);
          await sleep(1200 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(msg);
      }

      const textFromSegments = (data.segments ?? [])
        .map((s: { text?: string }) => (s.text ?? "").trim())
        .join(" ")
        .trim();
      const finalText = (data.text?.trim() || textFromSegments) ?? "";

      return {
        text: finalText,
        segments: (data.segments ?? []).map((s: Segment) => ({
          start: s.start,
          end: s.end,
          text: (s.text ?? "").trim(),
        })),
        duration: data.duration ?? null,
      };
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      lastError = isAbort
        ? new Error("زمان پردازش بخش تمام شد")
        : err instanceof Error
          ? err
          : new Error(String(err));
      if (attempt < CLIENT_RETRIES - 1) {
        await sleep(1200 * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw lastError ?? new Error("خطای ناشناخته در تبدیل");
}

function Index() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [model, setModel] = useState(MODELS[0].id);
  const [partMinutes, setPartMinutes] = useState(DEFAULT_PART_MINUTES);
  const [copied, setCopied] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisCopied, setAnalysisCopied] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancelJob = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setAnalysisMode(null);
    setAnalysisError(null);
  }, []);

  const send = useCallback(
    async (blob: Blob, name: string) => {
      cancelJob();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      setError(null);
      setText("");
      setSegments([]);
      setFileName(name);
      setProgressLabel(null);
      setProgressPct(0);
      clearAnalysis();

      try {
        const base = name.replace(/\.[^.]+$/, "") || "audio";
        let prepared;
        try {
          prepared = await prepareAudioForTranscription(
            blob,
            base,
            (msg) => setProgressLabel(msg),
            partMinutes,
          );
        } catch {
          throw new Error(
            "امکان رمزگشایی این فایل در مرورگر وجود ندارد. لطفاً به MP3 یا WAV تبدیل کنید.",
          );
        }

        const { parts } = prepared;
        if (parts.length === 0) throw new Error("فایل صوتی خالی یا نامعتبر است.");

        const allSegments: Segment[] = [];
        const textParts: string[] = [];
        const failed: string[] = [];

        for (let i = 0; i < parts.length; i++) {
          if (ac.signal.aborted) throw new Error("عملیات لغو شد.");
          const part = parts[i];
          setProgressLabel(
            parts.length === 1
              ? "در حال تبدیل…"
              : `در حال تبدیل بخش ${i + 1} از ${parts.length}…`,
          );
          setProgressPct(Math.round((i / parts.length) * 100));

          try {
            const result = await transcribeOne(part.blob, part.name, model, ac.signal);
            if (result.text) textParts.push(result.text);
            for (const s of result.segments) {
              allSegments.push({
                start: s.start + part.offsetSeconds,
                end: s.end + part.offsetSeconds,
                text: s.text,
              });
            }
            const partial =
              textParts.join(" ").trim() ||
              allSegments.map((s) => s.text).join(" ").trim();
            if (partial) {
              setText(partial);
              setSegments([...allSegments]);
            }
          } catch (partErr) {
            if (ac.signal.aborted) throw new Error("عملیات لغو شد.");
            failed.push(
              `بخش ${i + 1}: ${partErr instanceof Error ? partErr.message : String(partErr)}`,
            );
            await sleep(500);
          }
          setProgressPct(Math.round(((i + 1) / parts.length) * 100));
        }

        const finalText =
          textParts.join(" ").trim() ||
          allSegments.map((s) => s.text).join(" ").trim();

        if (!finalText) {
          throw new Error(
            failed.length
              ? `هیچ بخشی تبدیل نشد.\n${failed.join("\n")}`
              : "متنی تشخیص داده نشد. لطفاً دوباره تلاش کنید.",
          );
        }

        setText(finalText);
        setSegments(allSegments);
        if (failed.length > 0) {
          setError(`برخی بخش‌ها تبدیل نشدند (متن ناقص است):\n${failed.join("\n")}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "خطای ناشناخته");
      } finally {
        setLoading(false);
        setProgressLabel(null);
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [model, partMinutes, cancelJob, clearAnalysis],
  );

  const runAnalysis = useCallback(
    async (mode: AnalysisMode = "quick") => {
      const payload = text.trim();
      if (!payload || analyzing) return;
      setAnalyzing(true);
      setAnalysisError(null);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: payload, mode }),
        });
        let data: any;
        try {
          data = await res.json();
        } catch {
          throw new Error(`پاسخ نامعتبر از سرور (کد ${res.status})`);
        }
        if (!res.ok) {
          throw new Error(data?.error || `خطا در تحلیل (${res.status})`);
        }
        setAnalysis((data.analysis as string) || "");
        setAnalysisMode((data.mode as AnalysisMode) || mode);
      } catch (e) {
        setAnalysisError(e instanceof Error ? e.message : "خطای ناشناخته در تحلیل");
      } finally {
        setAnalyzing(false);
      }
    },
    [text, analyzing],
  );

  const stopRecording = useCallback(async () => {
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    nodeRef.current?.disconnect();
    const ctx = audioCtxRef.current;
    const rate = ctx?.sampleRate ?? 44100;
    await ctx?.close();
    const blob = encodeWav(chunksRef.current, rate);
    chunksRef.current = [];
    if (blob.size < 4096) {
      setError("ضبط بسیار کوتاه یا بی‌صدا بود. دوباره تلاش کنید.");
      return;
    }
    void send(blob, "recording.wav");
  }, [send]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      nodeRef.current = node;
      chunksRef.current = [];
      node.onaudioprocess = (e) => {
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(node);
      node.connect(ctx.destination);
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
    } catch {
      setError("دسترسی به میکروفون ممکن نشد. اجازه‌ی دسترسی را بررسی کنید.");
    }
  }, []);

  const onFile = (file?: File) => {
    if (!file) return;
    void send(file, file.name);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const copyAnalysis = async () => {
    if (!analysis) return;
    await navigator.clipboard.writeText(analysis);
    setAnalysisCopied(true);
    setTimeout(() => setAnalysisCopied(false), 1600);
  };

  const baseName = (fileName ?? "transcript").replace(/\.[^.]+$/, "") || "transcript";

  const downloadSubtitle = (kind: "srt" | "txt") => {
    if (kind === "txt") {
      if (!text) return;
      downloadText(toTxt(text), `${baseName}.txt`, "text/plain");
      return;
    }
    if (segments.length === 0) return;
    downloadText(toSrt(segments), `${baseName}.srt`, "application/x-subrip");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-12">
      <header className="text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">VoicePluss</h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-8 text-muted-foreground">
          VoicePluss — ضبط یا آپلود فایل صوتی و دریافت متن فارسی دقیق. فایل‌های طولانی
          به‌صورت خودکار تقسیم و متن‌ها ادغام می‌شوند.
        </p>
      </header>

      <section className="panel p-6 sm:p-8">
        <div className="flex flex-col items-center gap-5">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={loading}
            aria-label={recording ? "توقف ضبط" : "شروع ضبط"}
            className={`flex size-24 items-center justify-center rounded-full transition-all disabled:opacity-50 ${
              recording
                ? "recording-pulse bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground hover:scale-105"
            }`}
            style={{ boxShadow: recording ? undefined : "var(--shadow-glow)" }}
          >
            {recording ? <Square className="size-8" /> : <Mic className="size-9" />}
          </button>
          <p className="text-sm text-muted-foreground">
            {recording ? `در حال ضبط… ${formatTime(elapsed)}` : "برای شروع ضبط کلیک کنید"}
          </p>

          <div className="flex w-full flex-col items-center gap-4 border-t border-border pt-5 sm:flex-row sm:justify-between">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-surface-foreground transition-colors hover:bg-secondary">
              <Upload className="size-4" />
              آپلود فایل صوتی
              <input
                type="file"
                accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.webm"
                className="hidden"
                disabled={loading}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>

            <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">مدل:</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={loading}
                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">طول هر بخش:</span>
                <input
                  type="number"
                  min={1}
                  max={13}
                  step={1}
                  value={partMinutes}
                  disabled={loading}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setPartMinutes(Number.isFinite(v) ? clampPartMinutes(v) : DEFAULT_PART_MINUTES);
                  }}
                  className="w-16 rounded-xl border border-border bg-card px-2 py-2 text-center text-sm outline-none focus:ring-2 focus:ring-ring"
                  title="مدت هر بخش بر حسب دقیقه (۱ تا ۱۳)"
                />
                <span className="text-muted-foreground">دقیقه</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {loading && (
        <div className="panel flex flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin" />
            <span>{progressLabel || `در حال تبدیل «${fileName}» به متن…`}</span>
          </div>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.max(4, progressPct)}%` }}
            />
          </div>
          <p className="text-xs">{progressPct}٪</p>
          <button type="button" onClick={cancelJob} className="mt-1 text-xs text-destructive underline-offset-2 hover:underline">
            توقف پردازش
          </button>
        </div>
      )}

      {error && (
        <div className="whitespace-pre-wrap rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          {error}
        </div>
      )}

      {text && (
        <section className="panel p-6 sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">
              متن پیاده‌شده
              {loading ? <span className="mr-2 text-sm font-normal text-muted-foreground">(در حال تکمیل…)</span> : null}
            </h2>
            <div className="flex flex-wrap justify-end gap-2">
              {segments.length > 0 && !loading && (
                <button onClick={() => downloadSubtitle("srt")} className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary">
                  <Download className="size-4" /> SRT
                </button>
              )}
              {!loading && (
                <button onClick={() => downloadSubtitle("txt")} className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary">
                  <Download className="size-4" /> TXT
                </button>
              )}
              {!loading && (
                <button
                  onClick={() => void runAnalysis("quick")}
                  disabled={analyzing || !text.trim()}
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {analyzing ? "در حال تحلیل…" : "تحلیل متن"}
                </button>
              )}
              <button onClick={copy} disabled={!text} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "کپی شد" : "کپی"}
              </button>
              {!loading && (
                <button
                  onClick={() => {
                    setText("");
                    setSegments([]);
                    clearAnalysis();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  <Trash2 className="size-4" /> پاک کردن
                </button>
              )}
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              clearAnalysis();
            }}
            rows={8}
            readOnly={loading}
            className="w-full resize-y rounded-xl border border-border bg-surface p-4 text-base leading-9 outline-none focus:ring-2 focus:ring-ring"
          />

          {segments.length > 0 && !loading && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                نمایش زمان‌بندی جمله‌ها ({segments.length} بخش)
              </summary>
              <ul className="mt-3 space-y-2">
                {segments.map((s, i) => (
                  <li key={i} className="flex gap-3 rounded-xl bg-surface p-3 text-sm">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatTime(s.start)}</span>
                    <span className="leading-7">{s.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {analysisError && (
        <div className="whitespace-pre-wrap rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          {analysisError}
        </div>
      )}

      {analysis && (
        <section className="panel p-6 sm:p-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Sparkles className="size-5 text-primary" />
              {analysisMode === "full" ? "گزارش تحلیل کامل" : "تحلیل متن"}
            </h2>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => void runAnalysis("quick")}
                disabled={analyzing || !text.trim()}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
              >
                {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                تحلیل سریع
              </button>
              <button
                onClick={() => void runAnalysis("full")}
                disabled={analyzing || !text.trim()}
                className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                title="بررسی بخش‌به‌بخش و گزارش کامل"
              >
                {analyzing ? <Loader2 className="size-4 animate-spin" /> : <FileSearch className="size-4" />}
                تحلیل کامل
              </button>
              <button
                onClick={copyAnalysis}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {analysisCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {analysisCopied ? "کپی شد" : "کپی"}
              </button>
              <button
                onClick={clearAnalysis}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"
              >
                <Trash2 className="size-4" /> بستن
              </button>
            </div>
          </div>
          <div className="whitespace-pre-wrap rounded-xl border border-border bg-surface p-4 text-base leading-9">
            {analysis}
          </div>
        </section>
      )}

      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
        VoicePluss — فایل‌ها فقط برای پردازش ارسال می‌شوند. صوت‌های طولانی طبق «طول هر بخش» تقسیم می‌شوند (پیش‌فرض ۲ دقیقه).
      </footer>
    </main>
  );
}
