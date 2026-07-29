import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Square,
  Upload,
  Copy,
  Check,
  Loader2,
  Trash2,
  Download,
  Sparkles,
  FileSearch,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Gauge,
  Search,
  ChevronDown,
} from "lucide-react";
import { encodeWav } from "@/lib/wav";
import { toSrt, toTxt, downloadText, parseSrt } from "@/lib/subtitles";
import { prepareAudioForTranscription, DEFAULT_PART_MINUTES, clampPartMinutes } from "@/lib/splitAudio";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Waveform } from "@/components/Waveform";
import { extractPeaks } from "@/lib/waveform";


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

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIP_SECONDS = 10;
const CANCEL_MSG = "عملیات لغو شد.";

const CLIENT_TIMEOUT_MS = 240_000;
const CLIENT_RETRIES = 4;

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
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
    if (signal?.aborted) throw new Error(CANCEL_MSG);

    const form = new FormData();
    form.append("file", blob, name);
    form.append("model", model);

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

function SegmentRow({
  seg,
  index,
  isActive,
  hasAudio,
  cardRef,
  onSeek,
  onPlayOnly,
  onPlayContinue,
  onChange,
}: {
  seg: Segment;
  index: number;
  isActive: boolean;
  hasAudio: boolean;
  cardRef?: (el: HTMLLIElement | null) => void;
  onSeek: (t: number) => void;
  onPlayOnly: (s: Segment) => void;
  onPlayContinue: (s: Segment) => void;
  onChange: (index: number, value: string) => void;
}) {
  const [draft, setDraft] = useState(seg.text);
  const [editing, setEditing] = useState(false);

  // متن ویرایش‌نشده را با تغییرات بیرونی همگام کن (ولی وسط تایپ کاربر هرگز)
  useEffect(() => {
    if (!editing) setDraft(seg.text);
  }, [seg.text, editing]);

  return (
    <li
      ref={cardRef}
      className={`scroll-mt-4 rounded-xl border p-3 text-sm transition-colors ${
        isActive
          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
          : "border-transparent bg-surface hover:bg-secondary/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onSeek(seg.start)}
          className="shrink-0 pt-1.5 font-mono text-xs text-muted-foreground hover:text-primary"
          title="پرش به این بخش"
        >
          {formatTime(seg.start)}
        </button>
        <textarea
          value={draft}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange(index, e.target.value);
          }}
          onBlur={() => setEditing(false)}
          rows={2}
          className="min-w-0 flex-1 resize-y rounded-lg border border-transparent bg-transparent p-1.5 text-right text-sm leading-7 outline-none focus:border-border focus:bg-card focus:ring-2 focus:ring-ring"
          dir="rtl"
        />
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={() => onPlayOnly(seg)}
            disabled={!hasAudio}
            aria-label="فقط همین متن پخش شود"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
            title="فقط همین متن پخش شود"
          >
            <Play className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onPlayContinue(seg)}
            disabled={!hasAudio}
            aria-label="از این متن به بعد پخش شود"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
            title="از این متن به بعد پخش شود"
          >
            <SkipForward className="size-4" />
          </button>
        </div>

      </div>
    </li>
  );
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
  const [segmentQuery, setSegmentQuery] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [peaksLoading, setPeaksLoading] = useState(false);
  const [transcriptMinH, setTranscriptMinH] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const activeCardRef = useRef<HTMLLIElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const peaksReqIdRef = useRef(0);
  const rightColRef = useRef<HTMLDivElement | null>(null);

  const revokeAudioUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setAudioUrl(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const setSourceFromBlob = useCallback((blob: Blob) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    setAudioUrl(url);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1);

    const reqId = ++peaksReqIdRef.current;
    setPeaks([]);
    setPeaksLoading(true);
    void extractPeaks(blob).then((p) => {
      if (peaksReqIdRef.current === reqId) {
        setPeaks(p);
        setPeaksLoading(false);
      }
    });
  }, []);

  // ارتفاع ستون راست (پنل ضبط/آپلود + پخش صوت) را رصد کن تا پنل خروجی متن
  // حداقل هم‌ارتفاع با آن شود؛ فقط بزرگ‌تر می‌شود، هرگز کوچک نمی‌شود.
  useEffect(() => {
    const el = rightColRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.round(entry.contentRect.height);
        setTranscriptMinH((prev) => Math.max(prev, h));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const el = playerRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
  }, [playbackRate, audioUrl]);

  useEffect(() => {
    if (!error) return;
    if (!error.includes("لغو")) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);

  const activeSegmentIndex = useMemo(() => {
    if (segments.length === 0) return -1;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const nextStart = i + 1 < segments.length ? segments[i + 1].start : Number.POSITIVE_INFINITY;
      const end = Math.max(s.end, Math.min(nextStart, s.end + 0.01));
      if (currentTime >= s.start && currentTime < end) return i;
    }
    const last = segments[segments.length - 1];
    if (currentTime >= last.start) return segments.length - 1;
    return -1;
  }, [segments, currentTime]);

  // کارت فعال را به ابتدای محدودهٔ اسکرول لیست ببر
  useEffect(() => {
    if (activeSegmentIndex < 0) return;
    const list = listRef.current;
    const card = activeCardRef.current;
    if (!list || !card) return;
    list.scrollTo({
      top: Math.max(0, card.offsetTop - list.offsetTop - 24),
      behavior: "smooth",
    });
  }, [activeSegmentIndex]);

  const cancelJob = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setAnalysisMode(null);
    setAnalysisError(null);
  }, []);

  const rebuildTextFromSegments = useCallback((list: Segment[]) => {
    return list.map((s) => s.text.trim()).filter(Boolean).join(" ").trim();
  }, []);


  const updateSegmentText = useCallback(
    (index: number, value: string) => {
      setSegments((prev) => {
        const next = prev.map((s, i) => (i === index ? { ...s, text: value } : s));
        setText(rebuildTextFromSegments(next));
        return next;
      });
      clearAnalysis();
    },
    [rebuildTextFromSegments, clearAnalysis],
  );

  const playFrom = useCallback(
    (start: number, stopAt: number | null) => {
      const el = playerRef.current;
      if (!el || !audioUrl) return;
      const next = Math.max(0, Math.min(el.duration || 0, start));
      stopAtRef.current = stopAt;
      el.currentTime = next;
      setCurrentTime(next);
      void el.play().catch(() => setPlaying(false));
    },
    [audioUrl],
  );

  const playSegmentOnly = useCallback(
    (s: Segment) => playFrom(s.start, s.end),
    [playFrom],
  );
  const playSegmentContinue = useCallback(
    (s: Segment) => playFrom(s.start, null),
    [playFrom],
  );

  const togglePlay = useCallback(() => {
    const el = playerRef.current;
    if (!el || !audioUrl) return;
    if (el.paused) {
      stopAtRef.current = null;
      void el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, [audioUrl]);

  const skip = useCallback((delta: number) => {
    const el = playerRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
    el.currentTime = next;
    setCurrentTime(next);
  }, []);

  const seekTo = useCallback((time: number) => {
    const el = playerRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(el.duration || 0, time));
    el.currentTime = next;
    setCurrentTime(next);
  }, []);

  const filteredSegments = useMemo(() => {
    const q = segmentQuery.trim().toLowerCase();
    if (!q) return segments.map((s, i) => ({ s, i }));
    return segments
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.text.toLowerCase().includes(q));
  }, [segments, segmentQuery]);

  const send = useCallback(
    async (blob: Blob, name: string) => {
      cancelJob();
      const ac = new AbortController();
      abortRef.current = ac;

      setSourceFromBlob(blob);

      setLoading(true);
      setError(null);
      setText("");
      setSegments([]);
      setSegmentQuery("");
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
          if (ac.signal.aborted) throw new Error(CANCEL_MSG);
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
            if (ac.signal.aborted) throw new Error(CANCEL_MSG);
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
    [model, partMinutes, cancelJob, clearAnalysis, setSourceFromBlob],
  );

  const runAnalysis = useCallback(
    async (mode: AnalysisMode = "quick") => {
      const payload =
        text.trim() ||
        segments.map((s) => s.text.trim()).filter(Boolean).join(" ").trim();
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
    [text, segments, analyzing],
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
    cancelJob();
    setError(null);
    setText("");
    setSegments([]);
    setSegmentQuery("");
    clearAnalysis();
    setFileName(file.name);
    setSourceFromBlob(file);
    setPendingFile(file);
  };

  const startTranscription = () => {
    const file = pendingFile;
    if (!file) return;
    setPendingFile(null);
    void send(file, file.name);
  };

  const onSrtFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = parseSrt(await file.text());
      if (parsed.length === 0) {
        setError("فایل زیرنویس معتبر نبود یا خالی است.");
        return;
      }
      setSegments(parsed);
      setText(parsed.map((s) => s.text.trim()).filter(Boolean).join(" ").trim());
      setError(null);
      setPendingFile(null);
    } catch {
      setError("خواندن فایل زیرنویس ممکن نشد.");
    }
  };

  const copy = async () => {
    const body = segments.map((s) => s.text.trim()).filter(Boolean).join("\n");
    if (!body) return;
    await navigator.clipboard.writeText(body);
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
    if (segments.length === 0) return;
    if (kind === "txt") {
      downloadText(toTxt(segments), `${baseName}.txt`, "text/plain");
      return;
    }
    downloadText(toSrt(segments), `${baseName}.srt`, "application/x-subrip");
  };

  const hasTranscript = segments.length > 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-5 py-12 lg:max-w-6xl lg:px-4">
      <header className="text-center">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">VoicePluss</h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-8 text-muted-foreground">
          VoicePluss — ضبط یا آپلود فایل صوتی و دریافت متن فارسی دقیق. فایل‌های طولانی
          به‌صورت خودکار تقسیم و متن‌ها ادغام می‌شوند.
        </p>
      </header>


      <div className="lg:grid lg:grid-cols-[380px_1fr] lg:items-start lg:gap-6">
      <div ref={rightColRef} className="flex flex-col gap-6 lg:sticky lg:top-6">
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

      {pendingFile && !loading && (
        <section className="panel p-5 sm:p-6">
          <p className="text-sm font-bold">
            فایل صوتی «{pendingFile.name}» بارگذاری شد.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            آیا فایل زیرنویس (SRT) این صوت را دارید؟ اگر دارید آن را بارگذاری کنید تا
            بدون تبدیل مجدد نمایش داده شود.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary">
              <Upload className="size-4" />
              بارگذاری فایل SRT
              <input
                type="file"
                accept=".srt,.vtt,text/plain"
                className="hidden"
                onChange={(e) => void onSrtFile(e.target.files?.[0])}
              />
            </label>
            <button
              type="button"
              onClick={startTranscription}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Sparkles className="size-4" />
              شروع خروجی متن
            </button>
          </div>
        </section>
      )}

      {audioUrl && (
        <details open className="panel group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <span className="text-sm font-bold">پخش صوت{fileName ? ` — ${fileName}` : ""}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border px-5 pb-5 pt-4 sm:px-6">
            <audio
              ref={playerRef}
              src={audioUrl}
              preload="metadata"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                const stopAt = stopAtRef.current;
                if (stopAt != null && el.currentTime >= stopAt) {
                  stopAtRef.current = null;
                  el.pause();
                  el.currentTime = stopAt;
                  setCurrentTime(stopAt);
                  return;
                }
                setCurrentTime(el.currentTime || 0);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              className="hidden"
            />
            <div className="mb-3 flex items-center justify-end gap-2 text-sm">
              <Gauge className="size-3.5 text-muted-foreground" />
              <select
                value={playbackRate}
                onChange={(e) => setPlaybackRate(Number(e.target.value))}
                className="rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                title="سرعت پخش"
              >
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>{r === 1 ? "۱× عادی" : `${r}×`}</option>
                ))}
              </select>
            </div>

            <div className="mb-1">
              <Waveform
                peaks={peaks}
                loading={peaksLoading}
                progress={duration > 0 ? currentTime / duration : 0}
                onSeek={(ratio) => seekTo(ratio * (duration || 0))}
              />
              <div
                dir="ltr"
                className="mt-1.5 flex items-center justify-between text-xs font-mono text-muted-foreground"
              >
                <span className="tabular-nums">{formatTime(currentTime)}</span>
                <span className="tabular-nums">{formatTime(duration)}</span>
              </div>
            </div>

            <div dir="ltr" className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center">
              <div className="flex justify-end pr-3">
                <button
                  type="button"
                  onClick={() => skip(-SKIP_SECONDS)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                  title={`${SKIP_SECONDS} ثانیه عقب`}
                >
                  <SkipBack className="size-4" />
                  {SKIP_SECONDS}
                </button>
              </div>
              <button
                type="button"
                onClick={togglePlay}
                className="inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
                aria-label={playing ? "توقف" : "پخش"}
              >
                {playing ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
              </button>
              <div className="flex justify-start pl-3">
                <button
                  type="button"
                  onClick={() => skip(SKIP_SECONDS)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                  title={`${SKIP_SECONDS} ثانیه جلو`}
                >
                  {SKIP_SECONDS}
                  <SkipForward className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </details>
      )}

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

      </div>

      <div className="mt-6 flex flex-col gap-6 lg:mt-0">
      {hasTranscript && (
        <details
          open
          className="panel group flex flex-col overflow-hidden lg:h-[var(--transcript-min-h,auto)]"
          style={{ ["--transcript-min-h" as any]: transcriptMinH ? `${transcriptMinH}px` : undefined }}
        >
          <summary className="flex shrink-0 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <span className="text-sm font-bold">
              خروجی متن ({segments.length} بخش)
              {loading ? <span className="mr-2 text-xs font-normal text-muted-foreground"> (در حال تکمیل…)</span> : null}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex min-h-0 flex-1 flex-col border-t border-border px-5 pb-5 pt-4 sm:px-6">
            <div className="mb-3 flex shrink-0 items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={segmentQuery}
                  onChange={(e) => setSegmentQuery(e.target.value)}
                  placeholder="جستجو در جمله‌ها…"
                  className="w-full rounded-xl border border-border bg-card py-2.5 pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {filteredSegments.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">موردی یافت نشد.</p>
            ) : (
              <ul ref={listRef} className="min-h-0 max-h-80 flex-1 space-y-2 overflow-y-auto pt-3 pb-16 lg:max-h-none">
                {filteredSegments.map(({ s, i }) => (
                  <SegmentRow
                    key={i}
                    seg={s}
                    index={i}
                    isActive={i === activeSegmentIndex}
                    hasAudio={!!audioUrl}
                    cardRef={
                      i === activeSegmentIndex
                        ? (el) => {
                            activeCardRef.current = el;
                          }
                        : undefined
                    }
                    onSeek={seekTo}
                    onPlayOnly={playSegmentOnly}
                    onPlayContinue={playSegmentContinue}
                    onChange={updateSegmentText}
                  />
                ))}
              </ul>
            )}
            {segmentQuery.trim() && (
              <p className="mt-2 shrink-0 text-xs text-muted-foreground">
                {filteredSegments.length} از {segments.length} مورد
              </p>
            )}

            <div className="mt-4 flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-4">
              {!loading && (
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
                  disabled={analyzing || segments.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {analyzing ? "در حال تحلیل…" : "تحلیل متن"}
                </button>
              )}
              <button
                onClick={copy}
                disabled={segments.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "کپی شد" : "کپی"}
              </button>
            </div>
          </div>
        </details>
      )}

      {analysisError && (
        <div className="whitespace-pre-wrap rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          {analysisError}
        </div>
      )}

      {analysis && (
        <details open className="panel group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <span className="flex items-center gap-2 text-lg font-bold">
              <Sparkles className="size-5 text-primary" />
              {analysisMode === "full" ? "گزارش تحلیل کامل" : "تحلیل متن"}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border px-5 pb-5 pt-4 sm:px-6">
            <div className="mb-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => void runAnalysis("quick")}
                disabled={analyzing || segments.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
              >
                {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                تحلیل سریع
              </button>
              <button
                onClick={() => void runAnalysis("full")}
                disabled={analyzing || segments.length === 0}
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
            <div className="whitespace-pre-wrap rounded-xl border border-border bg-surface p-4 text-base leading-9">
              {analysis}
            </div>
          </div>
        </details>
      )}
      </div>
      </div>

      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
        VoicePluss — فایل‌ها فقط برای پردازش ارسال می‌شوند. صوت‌های طولانی طبق «طول هر بخش» تقسیم می‌شوند (پیش‌فرض ۲ دقیقه).
      </footer>
    </main>
  );
}
