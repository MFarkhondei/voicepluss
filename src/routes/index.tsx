import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Mic, Square, Upload, Copy, Check, Loader2, FileAudio, Trash2, Download } from "lucide-react";
import { encodeWav } from "@/lib/wav";
import { toSrt, toVtt, downloadText } from "@/lib/subtitles";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "تبدیل صوت به متن فارسی | مبتنی بر Groq" },
      {
        name: "description",
        content:
          "ضبط یا آپلود فایل صوتی و دریافت متن فارسی دقیق در چند ثانیه با موتور Whisper روی زیرساخت پرسرعت Groq.",
      },
      { property: "og:title", content: "تبدیل صوت به متن فارسی | مبتنی بر Groq" },
      {
        property: "og:description",
        content: "ضبط یا آپلود فایل صوتی و دریافت متن فارسی دقیق در چند ثانیه با موتور Whisper روی زیرساخت پرسرعت Groq.",
      },
    ],
  }),
  component: Index,
});

type Segment = { start: number; end: number; text: string };

const MODELS = [
  { id: "whisper-large-v3", label: "دقت بالا (whisper-large-v3)" },
  { id: "whisper-large-v3-turbo", label: "سریع (whisper-large-v3-turbo)" },
];

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function Index() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [model, setModel] = useState(MODELS[0].id);
  const [copied, setCopied] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = useCallback(
    async (blob: Blob, name: string) => {
      setLoading(true);
      setError(null);
      setText("");
      setSegments([]);
      setFileName(name);
      try {
        const form = new FormData();
        form.append("file", blob, name);
        form.append("model", model);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "خطا در پردازش فایل صوتی");
        if (!data.text) throw new Error("متنی تشخیص داده نشد. لطفاً دوباره ضبط کنید.");
        setText(data.text);
        setSegments(data.segments ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "خطای ناشناخته");
      } finally {
        setLoading(false);
      }
    },
    [model],
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

  const baseName = (fileName ?? "transcript").replace(/\.[^.]+$/, "") || "transcript";

  const downloadSubtitle = (kind: "srt" | "vtt") => {
    if (segments.length === 0) return;
    const content = kind === "srt" ? toSrt(segments) : toVtt(segments);
    downloadText(
      content,
      `${baseName}.${kind}`,
      kind === "srt" ? "application/x-subrip" : "text/vtt",
    );
  };



  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-12">
      <header className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground">
          <FileAudio className="size-3.5" /> موتور Whisper روی زیرساخت Groq
        </span>
        <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-5xl">
          تبدیل گفتار به متن فارسی
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-8 text-muted-foreground">
          صدایتان را ضبط کنید یا یک فایل صوتی بفرستید؛ در چند ثانیه متن فارسی تمیز و قابل
          ویرایش تحویل بگیرید.
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
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">مدل:</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {loading && (
        <div className="panel flex items-center justify-center gap-3 p-8 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          در حال تبدیل «{fileName}» به متن…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          {error}
        </div>
      )}

      {text && !loading && (
        <section className="panel p-6 sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">متن پیاده‌شده</h2>
            <div className="flex gap-2">
              <button
                onClick={copy}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "کپی شد" : "کپی"}
              </button>
              <button
                onClick={() => {
                  setText("");
                  setSegments([]);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"
              >
                <Trash2 className="size-4" />
                پاک کردن
              </button>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="w-full resize-y rounded-xl border border-border bg-surface p-4 text-base leading-9 outline-none focus:ring-2 focus:ring-ring"
          />

          {segments.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                نمایش زمان‌بندی جمله‌ها ({segments.length} بخش)
              </summary>
              <ul className="mt-3 space-y-2">
                {segments.map((s, i) => (
                  <li key={i} className="flex gap-3 rounded-xl bg-surface p-3 text-sm">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatTime(s.start)}
                    </span>
                    <span className="leading-7">{s.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
        فایل‌ها فقط برای پردازش ارسال می‌شوند و ذخیره نمی‌گردند.
      </footer>
    </main>
  );
}
