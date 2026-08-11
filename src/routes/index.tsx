import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Wand2,
  Keyboard,
  Languages,
  Repeat,

} from "lucide-react";
import { encodeWav } from "@/lib/wav";
import { toSrt, toTxt, downloadText, parseSrt } from "@/lib/subtitles";
import { prepareAudioForTranscription, DEFAULT_PART_MINUTES } from "@/lib/splitAudio";
import { extractPeaks } from "@/lib/waveform";
import { Waveform } from "@/components/Waveform";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VoicePluss | تبدیل صوت به متن" },
      {
        name: "description",
        content: "VoicePluss — ضبط یا آپلود صوت/ویدیو و دریافت متن فارسی یا انگلیسی دقیق.",
      },
    ],
  }),
  component: Index,
});

type Segment = {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  confidence?: number | null;
};
type AnalysisMode = "quick" | "full";
type OutputLanguage = "fa" | "en" | "de";

const TRANSCRIBE_MODEL = "whisper-large-v3";
const LOW_CONFIDENCE = 0.55;

const LANGUAGES: { id: OutputLanguage; label: string }[] = [
  { id: "fa", label: "فارسی" },
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
];

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIP_SECONDS = 10;
const CANCEL_MSG = "عملیات لغو شد.";
const CLIENT_TIMEOUT_MS = 240_000;
const CLIENT_RETRIES = 3;

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isLowConfidence(c?: number | null) {
  return typeof c === "number" && Number.isFinite(c) && c < LOW_CONFIDENCE;
}

function friendlyRefineError(raw: string): string {
  const t = raw.toLowerCase();
  if (
    t.includes("rate limit") ||
    t.includes("tokens per minute") ||
    t.includes("tpm") ||
    t.includes("429") ||
    t.includes("محدودیت سرویس")
  ) {
    return "به علت محدودیت سرویس امکان اصلاح متن وجود ندارد. چند لحظه بعد دوباره تلاش کنید.";
  }
  if (t.includes("401") || t.includes("403") || t.includes("api key")) {
    return "دسترسی به سرویس بهبود متن ممکن نیست. کلید سرویس را بررسی کنید.";
  }
  if (/[\u0600-\u06FF]/.test(raw) && raw.length < 200) return raw.replace(/^خطای بهبود متن:\s*/i, "");
  return "خطا در بهبود متن. لطفاً دوباره تلاش کنید.";
}

async function transcribeOne(
  blob: Blob,
  name: string,
  language: OutputLanguage,
  signal?: AbortSignal,
): Promise<{ text: string; segments: Segment[]; duration: number | null }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < CLIENT_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error(CANCEL_MSG);
    const form = new FormData();
    form.append("file", blob, name);
    form.append("model", TRANSCRIBE_MODEL);
    form.append("language", language);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form, signal: controller.signal });
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      let data: any;
      try { data = await res.json(); } catch { throw new Error(`پاسخ نامعتبر از سرور (کد ${res.status})`); }
      if (!res.ok) {
        const msg = data?.error || `خطا در پردازش فایل صوتی (${res.status})`;
        lastError = new Error(msg);
        if (attempt < CLIENT_RETRIES - 1) {
          await sleep(1200 * Math.pow(2, attempt));
          continue;
        }
        throw lastError;
      }
      const textFromSegments = (data.segments ?? []).map((s: { text?: string }) => (s.text ?? "").trim()).join(" ").trim();
      const finalText = (data.text?.trim() || textFromSegments) ?? "";
      return {
        text: finalText,
        segments: (data.segments ?? []).map((s: Segment & { confidence?: number | null }) => ({
          start: s.start,
          end: s.end,
          text: (s.text ?? "").trim(),
          confidence: typeof s.confidence === "number" ? s.confidence : null,
        })),
        duration: data.duration ?? null,
      };
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      lastError = isAbort ? new Error("زمان پردازش بخش تمام شد") : err instanceof Error ? err : new Error(String(err));
      if (attempt < CLIENT_RETRIES - 1) { await sleep(1200 * Math.pow(2, attempt)); continue; }
    }
  }
  throw lastError ?? new Error("خطای ناشناخته در تبدیل");
}

function SegmentRow({
  seg, index, isActive, hasAudio, cardRef, onSeek, onPlayOnly, onPlayContinue, onChange, onEditStart,
}: {
  seg: Segment; index: number; isActive: boolean; hasAudio: boolean;
  cardRef?: (el: HTMLLIElement | null) => void;
  onSeek: (t: number) => void; onPlayOnly: (s: Segment, i: number) => void; onPlayContinue: (s: Segment, i: number) => void;
  onChange: (index: number, value: string) => void;
  onEditStart?: () => void;
}) {
  const [draft, setDraft] = useState(seg.text);
  const [editing, setEditing] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const low = isLowConfidence(seg.confidence);
  useEffect(() => { if (!editing) setDraft(seg.text); }, [seg.text, editing]);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const translate = useCallback(async () => {
    const value = draft.trim();
    if (!value || translating) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      const data = (await res.json()) as { translation?: string; error?: string };
      if (!res.ok || !data.translation) throw new Error(data.error || "ترجمه انجام نشد.");
      setTranslation(data.translation);
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "ترجمه انجام نشد.");
    } finally {
      setTranslating(false);
    }
  }, [draft, translating]);

  const baseClass = isActive
    ? "border-primary bg-primary/10 ring-1 ring-primary/40"
    : low
      ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/15"
      : "border-transparent bg-surface hover:bg-secondary/60";
  return (
    <li ref={cardRef} aria-current={isActive ? "true" : undefined} className={`scroll-mt-4 rounded-xl border p-3 text-sm transition-colors ${baseClass}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {seg.speaker ? (
          <p className="inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">{seg.speaker}</p>
        ) : null}
        {low ? (
          <p
            className="inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200"
            title={typeof seg.confidence === "number" ? `اطمینان مدل: ${Math.round(seg.confidence * 100)}٪` : "اطمینان پایین"}
          >
            اطمینان پایین{typeof seg.confidence === "number" ? ` · ${Math.round(seg.confidence * 100)}٪` : ""}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 items-start gap-2 sm:gap-3">
        <button type="button" onClick={() => onSeek(seg.start)} aria-label={`پرش به دقیقه ${formatTime(seg.start)}`} className="shrink-0 pt-1.5 font-mono text-xs text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" title="پرش به این بخش">{formatTime(seg.start)}</button>
        <div className="min-w-0 flex-1">
          <textarea ref={taRef} value={draft} aria-label={`متن بخش ${index + 1} از دقیقه ${formatTime(seg.start)}`} onFocus={() => { onEditStart?.(); setEditing(true); }} onChange={(e) => { setDraft(e.target.value); onChange(index, e.target.value); }} onBlur={() => setEditing(false)} rows={1} className="block w-full resize-none overflow-hidden rounded-lg border border-transparent bg-transparent p-1.5 text-right text-sm leading-7 outline-none focus:border-border focus:bg-card focus:ring-2 focus:ring-ring" dir="rtl" />
          {translation ? (
            <p dir="rtl" className="mt-1.5 rounded-lg border border-accent/30 bg-accent/10 p-2 text-right text-sm leading-7">{translation}</p>
          ) : null}
          {translateError ? (
            <p dir="rtl" className="mt-1.5 text-right text-xs text-destructive">{translateError}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button type="button" onClick={() => onPlayOnly(seg, index)} disabled={!hasAudio} aria-label="فقط همین متن پخش شود" className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40" title="فقط همین متن پخش شود"><Play className="size-4" aria-hidden="true" /></button>
          <button type="button" onClick={() => onPlayContinue(seg, index)} disabled={!hasAudio} aria-label="از این متن به بعد پخش شود" className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40" title="از این متن به بعد پخش شود"><SkipForward className="size-4" aria-hidden="true" /></button>
          <button type="button" onClick={() => void translate()} disabled={translating || !draft.trim()} aria-label="ترجمه به فارسی" className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40" title="ترجمه به فارسی">
            {translating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Languages className="size-4" aria-hidden="true" />}
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
  const [health, setHealth] = useState<{ state: "checking" | "ok" | "error"; message: string; latency?: number }>({
    state: "checking",
    message: "در حال بررسی سرویس…",
  });
  const [progressPct, setProgressPct] = useState(0);
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [language, setLanguage] = useState<OutputLanguage>("fa");
  const [copied, setCopied] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisCopied, setAnalysisCopied] = useState(false);
  const [segmentQuery, setSegmentQuery] = useState("");
  const [onlyLowConfidence, setOnlyLowConfidence] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [textLockH, setTextLockH] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [repeatMode, setRepeatMode] = useState<"off" | "inf" | "1" | "2" | "3" | "4" | "5">("off");

  const [peaks, setPeaks] = useState<number[]>([]);
  const [peaksLoading, setPeaksLoading] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [diarize, setDiarize] = useState(false);
  const [status, setStatus] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);

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
  const repeatIdxRef = useRef<number | null>(null);
  const repeatDoneRef = useRef(0);

  const panelsRef = useRef<HTMLDivElement | null>(null);
  const textLockHRef = useRef<number | null>(null);
  const peakJobRef = useRef(0);

  const setSourceFromBlob = useCallback((blob: Blob, opts?: { skipPeaks?: boolean }) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    setAudioUrl(url);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1);
    const job = ++peakJobRef.current;
    setPeaks([]);
    if (opts?.skipPeaks) {
      setPeaksLoading(false);
      return;
    }
    setPeaksLoading(true);
    void extractPeaks(blob, 160)
      .then((p) => { if (peakJobRef.current === job) setPeaks(p); })
      .finally(() => { if (peakJobRef.current === job) setPeaksLoading(false); });
  }, []);

  const loadPeaksFromBlob = useCallback((blob: Blob) => {
    const job = ++peakJobRef.current;
    setPeaksLoading(true);
    void extractPeaks(blob, 160)
      .then((p) => { if (peakJobRef.current === job) setPeaks(p); })
      .finally(() => { if (peakJobRef.current === job) setPeaksLoading(false); });
  }, []);

  useEffect(() => () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  // تست کوتاه سرویس Groq هنگام باز شدن برنامه
  const runHealthCheck = useCallback(async () => {
    setHealth({ state: "checking", message: "در حال بررسی سرویس…" });
    try {
      const res = await fetch("/api/health");
      const data = (await res.json()) as { ok?: boolean; message?: string; latency?: number };
      setHealth({
        state: data.ok ? "ok" : "error",
        message: data.message || (data.ok ? "سرویس Groq فعال است" : "سرویس در دسترس نیست"),
        latency: data.latency,
      });
    } catch {
      setHealth({ state: "error", message: "اتصال به سرور برقرار نشد" });
    }
  }, []);
  useEffect(() => { void runHealthCheck(); }, [runHealthCheck]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => { const el = playerRef.current; if (!el) return; el.playbackRate = playbackRate; }, [playbackRate, audioUrl]);
  useEffect(() => {
    if (!error || !error.includes("لغو")) return;
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

  const lowConfidenceCount = useMemo(
    () => segments.filter((s) => isLowConfidence(s.confidence)).length,
    [segments],
  );

  useEffect(() => {
    if (activeSegmentIndex < 0) return;
    const list = listRef.current;
    const card = activeCardRef.current;
    if (!list || !card) return;
    list.scrollTo({ top: Math.max(0, card.offsetTop - list.offsetTop - 8), behavior: "smooth" });
  }, [activeSegmentIndex]);

  useLayoutEffect(() => {
    if (segments.length === 0) { textLockHRef.current = null; setTextLockH(null); return; }
    const el = panelsRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h <= 0) return;
      const next = textLockHRef.current == null ? h : Math.max(textLockHRef.current, h);
      if (next !== textLockHRef.current) { textLockHRef.current = next; setTextLockH(next); }
    };
    measure();
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [segments.length, audioUrl, recording, pendingFile, isDesktop]);

  const cancelJob = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; }, []);
  const clearAnalysis = useCallback(() => { setAnalysis(null); setAnalysisMode(null); setAnalysisError(null); }, []);
  const rebuildTextFromSegments = useCallback((list: Segment[]) => list.map((s) => s.text.trim()).filter(Boolean).join(" ").trim(), []);
  const updateSegmentText = useCallback((index: number, value: string) => {
    setSegments((prev) => {
      const next = prev.map((s, i) => (i === index ? { ...s, text: value } : s));
      setText(rebuildTextFromSegments(next));
      return next;
    });
    clearAnalysis();
  }, [rebuildTextFromSegments, clearAnalysis]);

  const playFrom = useCallback((start: number, stopAt: number | null) => {
    const el = playerRef.current;
    if (!el || !audioUrl) return;
    const next = Math.max(0, Math.min(el.duration || 0, start));
    stopAtRef.current = stopAt;
    el.currentTime = next;
    setCurrentTime(next);
    void el.play().catch(() => setPlaying(false));
  }, [audioUrl]);
  const playSegmentOnly = useCallback((s: Segment, i?: number) => {
    repeatIdxRef.current = typeof i === "number" ? i : null;
    repeatDoneRef.current = 0;
    playFrom(s.start, s.end);
  }, [playFrom]);
  const playSegmentContinue = useCallback((s: Segment, i?: number) => {
    if (repeatMode !== "off" && typeof i === "number") {
      repeatIdxRef.current = i;
      repeatDoneRef.current = 0;
      playFrom(s.start, s.end);
      return;
    }
    repeatIdxRef.current = null;
    playFrom(s.start, null);
  }, [playFrom, repeatMode]);
  const togglePlay = useCallback(() => {
    const el = playerRef.current;
    if (!el || !audioUrl) return;
    if (el.paused) { stopAtRef.current = null; void el.play().catch(() => setPlaying(false)); }
    else el.pause();
  }, [audioUrl]);
  const pauseForEdit = useCallback(() => {
    const el = playerRef.current;
    if (!el || !audioUrl) return;
    if (!el.paused) {
      stopAtRef.current = null;
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
  const seekRatio = useCallback((ratio: number) => {
    const el = playerRef.current;
    if (!el) return;
    const total = el.duration || duration || 0;
    stopAtRef.current = null;
    const next = Math.max(0, Math.min(total, ratio * total));
    el.currentTime = next;
    setCurrentTime(next);
  }, [duration]);

  const refineTranscript = useCallback(async () => {
    if (segments.length === 0 || refining) return;
    setRefining(true);
    setRefineError(null);
    setStatus(diarize ? "در حال اصلاح املا، علائم و تفکیک گویندگان…" : "در حال اصلاح املا و علائم…");
    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: segments.map((s, i) => ({ i, text: s.text })),
          language,
          diarize,
        }),
      });
      let data: any;
      try { data = await res.json(); } catch { throw new Error(`پاسخ نامعتبر از سرور (کد ${res.status})`); }
      if (!res.ok) throw new Error(data?.error || `خطا در بهبود متن (${res.status})`);
      const map = new Map<number, { text: string; speaker?: string | null }>(
        (data.segments ?? []).map((s: any) => [Number(s.i), { text: String(s.text ?? ""), speaker: s.speaker ?? null }]),
      );
      const next = segments.map((s, i) => {
        const r = map.get(i);
        return r ? { ...s, text: r.text.trim() || s.text, speaker: r.speaker ?? null } : s;
      });
      setSegments(next);
      setText(rebuildTextFromSegments(next));
      setStatus("املا و علائم اصلاح شد.");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "خطای ناشناخته در بهبود متن";
      setRefineError(friendlyRefineError(raw));
      setStatus("بهبود متن ناموفق بود.");
    } finally {
      setRefining(false);
    }
  }, [segments, refining, language, diarize, rebuildTextFromSegments]);

  const filteredSegments = useMemo(() => {
    let list = segments.map((s, i) => ({ s, i }));
    if (onlyLowConfidence) list = list.filter(({ s }) => isLowConfidence(s.confidence));
    const q = segmentQuery.trim().toLowerCase();
    if (q) list = list.filter(({ s }) => s.text.toLowerCase().includes(q));
    return list;
  }, [segments, segmentQuery, onlyLowConfidence]);

  const send = useCallback(async (blob: Blob, name: string) => {
    cancelJob();
    const ac = new AbortController();
    abortRef.current = ac;
    setSourceFromBlob(blob, { skipPeaks: true });
    setLoading(true);
    setError(null);
    setText("");
    setSegments([]);
    setSegmentQuery("");
    setOnlyLowConfidence(false);
    setFileName(name);
    setProgressLabel(null);
    setProgressPct(0);
    textLockHRef.current = null;
    setTextLockH(null);
    clearAnalysis();
    try {
      const base = name.replace(/\.[^.]+$/, "") || "audio";
      let prepared;
      try {
        prepared = await prepareAudioForTranscription(blob, base, (msg) => setProgressLabel(msg), DEFAULT_PART_MINUTES);
      } catch (prepErr) {
        const msg = prepErr instanceof Error ? prepErr.message : "";
        if (msg.includes("حافظه")) throw prepErr;
        throw new Error("امکان استخراج صوت از این فایل در مرورگر وجود ندارد. لطفاً MP3، WAV، یا MP4 سازگار امتحان کنید.");
      }
      const { parts } = prepared;
      if (parts.length === 0) throw new Error("فایل صوتی خالی یا نامعتبر است.");
      if (parts[0]?.blob) loadPeaksFromBlob(parts[0].blob);
      const allSegments: Segment[] = [];
      const textParts: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        if (ac.signal.aborted) throw new Error(CANCEL_MSG);
        const part = parts[i];
        setProgressLabel(parts.length === 1 ? "در حال تبدیل…" : `در حال تبدیل بخش ${i + 1} از ${parts.length}…`);
        setProgressPct(Math.round((i / parts.length) * 100));
        try {
          const result = await transcribeOne(part.blob, part.name, language, ac.signal);
          if (result.text) textParts.push(result.text);
          for (const s of result.segments) {
            allSegments.push({
              start: s.start + part.offsetSeconds,
              end: s.end + part.offsetSeconds,
              text: s.text,
              confidence: s.confidence ?? null,
            });
          }
          const partial = textParts.join(" ").trim() || allSegments.map((s) => s.text).join(" ").trim();
          if (partial) { setText(partial); setSegments([...allSegments]); }
        } catch (partErr) {
          if (ac.signal.aborted) throw new Error(CANCEL_MSG);
          const detail = partErr instanceof Error ? partErr.message : String(partErr);
          failed.push(`بخش ${i + 1}: ${detail}`);
          // پس از ۳ تلاش ناموفق روی این بخش، پردازش متوقف می‌شود
          const partialText = textParts.join(" ").trim() || allSegments.map((s) => s.text).join(" ").trim();
          if (partialText) { setText(partialText); setSegments([...allSegments]); }
          throw new Error(
            `تبدیل بخش ${i + 1} از ${parts.length} پس از ۳ تلاش ناموفق بود و پردازش متوقف شد.\n${detail}`,
          );
        }
        setProgressPct(Math.round(((i + 1) / parts.length) * 100));
      }
      const finalText = textParts.join(" ").trim() || allSegments.map((s) => s.text).join(" ").trim();
      if (!finalText) {
        throw new Error(failed.length ? `هیچ بخشی تبدیل نشد.\n${failed.join("\n")}` : "متنی تشخیص داده نشد. لطفاً دوباره تلاش کنید.");
      }
      setText(finalText);
      setSegments(allSegments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
      setProgressLabel(null);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [language, cancelJob, clearAnalysis, setSourceFromBlob, loadPeaksFromBlob]);

  const runAnalysis = useCallback(async (mode: AnalysisMode = "quick") => {
    const payload = text.trim() || segments.map((s) => s.text.trim()).filter(Boolean).join(" ").trim();
    if (!payload || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: payload, mode }) });
      let data: any;
      try { data = await res.json(); } catch { throw new Error(`پاسخ نامعتبر از سرور (کد ${res.status})`); }
      if (!res.ok) throw new Error(data?.error || `خطا در تحلیل (${res.status})`);
      setAnalysis((data.analysis as string) || "");
      setAnalysisMode((data.mode as AnalysisMode) || mode);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "خطای ناشناخته در تحلیل");
    } finally {
      setAnalyzing(false);
    }
  }, [text, segments, analyzing]);

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
    if (blob.size < 4096) { setError("ضبط بسیار کوتاه یا بی‌صدا بود. دوباره تلاش کنید."); return; }
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
      node.onaudioprocess = (e) => { chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
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
    setOnlyLowConfidence(false);
    textLockHRef.current = null;
    setTextLockH(null);
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
      if (parsed.length === 0) { setError("فایل زیرنویس معتبر نبود یا خالی است."); return; }
      setSegments(parsed);
      setText(parsed.map((s) => s.text.trim()).filter(Boolean).join(" ").trim());
      setError(null);
      setPendingFile(null);
      setOnlyLowConfidence(false);
    } catch { setError("خواندن فایل زیرنویس ممکن نشد."); }
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
    if (kind === "txt") { downloadText(toTxt(segments), `${baseName}.txt`, "text/plain"); return; }
    downloadText(toSrt(segments), `${baseName}.srt`, "application/x-subrip");
  };

  const hasTranscript = segments.length > 0;

  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (segments.length > 0) { downloadSubtitle("txt"); setStatus("فایل متن ذخیره شد."); }
        return;
      }
      if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (segments.length > 0) { downloadSubtitle("srt"); setStatus("فایل زیرنویس ذخیره شد."); }
        return;
      }
      if (isTyping(e.target) || mod || e.altKey) return;
      if (e.key === " ") {
        if (!audioUrl) return;
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === "ArrowRight" && audioUrl) { e.preventDefault(); skip(SKIP_SECONDS); return; }
      if (e.key === "ArrowLeft" && audioUrl) { e.preventDefault(); skip(-SKIP_SECONDS); return; }
      if (e.key === "?") { e.preventDefault(); setShowShortcuts((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audioUrl, segments.length, togglePlay, skip, downloadSubtitle]);

  const controlsColumn = (
    <div className="flex min-w-0 w-full flex-col gap-6">
      <div ref={panelsRef} className="flex min-w-0 flex-col gap-6">
        <details open className="panel group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-4 sm:px-6">
            <span className="min-w-0 text-sm font-bold">{recording ? `در حال ضبط… ${formatTime(elapsed)}` : "شروع ضبط و بارگذاری فایل"}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border px-3 pb-5 pt-4 sm:px-6">
            <div className="flex flex-col items-center gap-5">
              <button
                type="button"
                onClick={() => void runHealthCheck()}
                disabled={health.state === "checking"}
                aria-live="polite"
                title="تست سرویس Groq"
                className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  health.state === "ok"
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : health.state === "error"
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-border bg-surface text-muted-foreground"
                }`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    health.state === "ok" ? "bg-primary" : health.state === "error" ? "bg-destructive" : "animate-pulse bg-muted-foreground"
                  }`}
                />
                <span className="truncate">
                  {health.state === "ok"
                    ? `سرویس Groq فعال است${health.latency ? ` (${health.latency} میلی‌ثانیه)` : ""}`
                    : health.message}
                </span>
              </button>

              <button onClick={recording ? stopRecording : startRecording} disabled={loading} aria-label={recording ? "توقف ضبط" : "شروع ضبط"} className={`flex size-24 items-center justify-center rounded-full transition-all disabled:opacity-50 ${recording ? "recording-pulse bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground hover:scale-105"}`} style={{ boxShadow: recording ? undefined : "var(--shadow-glow)" }}>
                {recording ? <Square className="size-8" /> : <Mic className="size-9" />}
              </button>
              <p className="text-sm text-muted-foreground">{recording ? `در حال ضبط… ${formatTime(elapsed)}` : "برای شروع ضبط کلیک کنید"}</p>
              <div className="flex w-full min-w-0 flex-col items-center gap-4 border-t border-border pt-5 sm:flex-row sm:justify-between">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-surface-foreground transition-colors hover:bg-secondary sm:px-4">
                  <Upload className="size-4 shrink-0" /> آپلود صوت یا ویدیو
                  <input type="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4,.mov,.mkv,.avi" className="hidden" disabled={loading} onChange={(e) => onFile(e.target.files?.[0])} />
                </label>
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="shrink-0 text-muted-foreground">زبان خروجی:</span>
                  <select value={language} onChange={(e) => setLanguage(e.target.value as OutputLanguage)} disabled={loading} className="max-w-[min(100%,8rem)] rounded-xl border border-border bg-card px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:px-3" title="زبان متن خروجی">
                    {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </details>

        {audioUrl && (
          <details open className="panel group overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-4 sm:px-6">
              <span className="min-w-0 truncate text-sm font-bold">پخش صوت{fileName ? ` — ${fileName}` : ""}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-border px-3 pb-5 pt-4 sm:px-6">
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
                    const idx = repeatIdxRef.current;
                    if (repeatMode !== "off" && idx != null && segments[idx]) {
                      const limit = repeatMode === "inf" ? Number.POSITIVE_INFINITY : Number(repeatMode);
                      repeatDoneRef.current += 1;
                      if (repeatDoneRef.current < limit) {
                        const s = segments[idx];
                        stopAtRef.current = s.end;
                        el.currentTime = s.start;
                        setCurrentTime(s.start);
                        void el.play().catch(() => setPlaying(false));
                        return;
                      }
                      const next = segments[idx + 1];
                      if (next) {
                        repeatIdxRef.current = idx + 1;
                        repeatDoneRef.current = 0;
                        stopAtRef.current = next.end;
                        el.currentTime = next.start;
                        setCurrentTime(next.start);
                        void el.play().catch(() => setPlaying(false));
                        return;
                      }
                      repeatIdxRef.current = null;
                    }
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
              <div className="mb-3 flex flex-wrap items-center justify-end gap-2 text-sm">
                <Repeat className="size-3.5 text-muted-foreground" />
                <select
                  value={repeatMode}
                  onChange={(e) => {
                    setRepeatMode(e.target.value as typeof repeatMode);
                    repeatDoneRef.current = 0;
                  }}
                  className="rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                  title="تعداد تکرار هر بخش"
                >
                  <option value="off">بدون تکرار</option>
                  <option value="1">۱ بار</option>
                  <option value="2">۲ بار</option>
                  <option value="3">۳ بار</option>
                  <option value="4">۴ بار</option>
                  <option value="5">۵ بار</option>
                  <option value="inf">تکرار نامحدود</option>
                </select>
                <Gauge className="size-3.5 text-muted-foreground" />
                <select value={playbackRate} onChange={(e) => setPlaybackRate(Number(e.target.value))} className="rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring" title="سرعت پخش">
                  {PLAYBACK_RATES.map((r) => <option key={r} value={r}>{r === 1 ? "۱× عادی" : `${r}×`}</option>)}
                </select>
              </div>

              <div className="mb-3">
                <Waveform
                  peaks={peaks}
                  progress={duration > 0 ? Math.min(1, currentTime / duration) : 0}
                  loading={peaksLoading}
                  duration={duration}
                  onSeek={seekRatio}
                  onSkip={skip}
                  skipSeconds={SKIP_SECONDS}
                />
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  وسط موج: پرش به زمان · سمت چپ: {SKIP_SECONDS}ث عقب · سمت راست / کلیک راست: {SKIP_SECONDS}ث جلو
                </p>
              </div>
              <div dir="ltr" className="mb-1 flex min-w-0 items-center gap-2 text-xs font-mono text-muted-foreground sm:gap-3">
                <span className="w-9 shrink-0 tabular-nums sm:w-10">{formatTime(currentTime)}</span>
                <input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(currentTime, duration || 0)} onChange={(e) => seekTo(Number(e.target.value))} className="h-2 min-w-0 flex-1 cursor-pointer accent-primary" aria-label="موقعیت پخش" />
                <span className="w-9 shrink-0 text-end tabular-nums sm:w-10">{formatTime(duration)}</span>
              </div>
              <div dir="ltr" className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center">
                <div className="flex justify-end pr-2 sm:pr-3">
                  <button type="button" onClick={() => skip(-SKIP_SECONDS)} className="inline-flex items-center gap-1 rounded-xl border border-border px-2.5 py-2 text-sm font-medium transition-colors hover:bg-secondary sm:gap-1.5 sm:px-3" title={`${SKIP_SECONDS} ثانیه عقب`}><SkipBack className="size-4" />{SKIP_SECONDS}</button>
                </div>
                <button type="button" onClick={togglePlay} className="inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90" aria-label={playing ? "توقف" : "پخش"}>
                  {playing ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
                </button>
                <div className="flex justify-start pl-2 sm:pl-3">
                  <button type="button" onClick={() => skip(SKIP_SECONDS)} className="inline-flex items-center gap-1 rounded-xl border border-border px-2.5 py-2 text-sm font-medium transition-colors hover:bg-secondary sm:gap-1.5 sm:px-3" title={`${SKIP_SECONDS} ثانیه جلو`}>{SKIP_SECONDS}<SkipForward className="size-4" /></button>
                </div>
              </div>
            </div>
          </details>
        )}
      </div>

      {pendingFile && !loading && (
        <section className="panel min-w-0 p-4 sm:p-6">
          <p className="text-sm font-bold">فایل «{pendingFile.name}» بارگذاری شد.</p>
          <p className="mt-2 text-sm text-muted-foreground">برای ویدیو فقط صوت استخراج و به متن تبدیل می‌شود. اگر فایل زیرنویس (SRT) دارید می‌توانید بارگذاری کنید.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary">
              <Upload className="size-4" /> بارگذاری فایل SRT
              <input type="file" accept=".srt,.vtt,text/plain" className="hidden" onChange={(e) => void onSrtFile(e.target.files?.[0])} />
            </label>
            <button type="button" onClick={startTranscription} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              <Sparkles className="size-4" /> شروع خروجی متن
            </button>
          </div>
        </section>
      )}

      {loading && (
        <div className="panel flex min-w-0 flex-col items-center justify-center gap-3 p-6 text-muted-foreground sm:p-8">
          <div className="flex items-center gap-3"><Loader2 className="size-5 shrink-0 animate-spin" /><span className="min-w-0 text-center">{progressLabel || `در حال تبدیل «${fileName}» به متن…`}</span></div>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.max(4, progressPct)}%` }} /></div>
          <p className="text-xs">{progressPct}٪</p>
          <button type="button" onClick={cancelJob} className="mt-1 text-xs text-destructive underline-offset-2 hover:underline">توقف پردازش</button>
        </div>
      )}

      {error && <div className="min-w-0 whitespace-pre-wrap rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive sm:p-5">{error}</div>}
    </div>
  );

  const lockedStyle = isDesktop && textLockH ? { height: textLockH, minHeight: textLockH } : undefined;

  const textPanel = hasTranscript ? (
    <div className="panel group flex min-w-0 flex-col overflow-hidden" style={lockedStyle}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-3 py-4 sm:px-6">
        <span className="min-w-0 text-sm font-bold">خروجی متن ({segments.length} بخش){loading ? <span className="mr-2 text-xs font-normal text-muted-foreground"> (در حال تکمیل…)</span> : null}</span>
        {lowConfidenceCount > 0 ? (
          <button
            type="button"
            onClick={() => setOnlyLowConfidence((v) => !v)}
            aria-pressed={onlyLowConfidence}
            title={onlyLowConfidence ? "نمایش همه بخش‌ها" : "فقط بخش‌های با اطمینان پایین"}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              onlyLowConfidence
                ? "bg-amber-500 text-white ring-2 ring-amber-500/40"
                : "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200"
            }`}
          >
            {onlyLowConfidence ? "نمایش همه" : `${lowConfidenceCount} بخش با اطمینان پایین`}
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-border px-3 pb-5 pt-4 sm:px-6">
        <div className="mb-3 flex shrink-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" value={segmentQuery} onChange={(e) => setSegmentQuery(e.target.value)} placeholder="جستجو در جمله‌ها…" className="w-full min-w-0 rounded-xl border border-border bg-card py-2.5 pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
        {filteredSegments.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {onlyLowConfidence && !segmentQuery.trim() ? "بخشی با اطمینان پایین یافت نشد." : "موردی یافت نشد."}
          </p>
        ) : (
          <ul ref={listRef} className={`min-h-0 min-w-0 space-y-2 overflow-y-auto overflow-x-hidden ${isDesktop && textLockH ? "flex-1" : "max-h-[22rem]"}`}>
            {filteredSegments.map(({ s, i }) => (
              <SegmentRow key={i} seg={s} index={i} isActive={i === activeSegmentIndex} hasAudio={!!audioUrl} cardRef={i === activeSegmentIndex ? (el) => { activeCardRef.current = el; } : undefined} onSeek={seekTo} onPlayOnly={playSegmentOnly} onPlayContinue={playSegmentContinue} onChange={updateSegmentText} onEditStart={pauseForEdit} />
            ))}
          </ul>
        )}
        {(segmentQuery.trim() || onlyLowConfidence) && (
          <p className="mt-2 shrink-0 text-xs text-muted-foreground">
            {filteredSegments.length} از {segments.length} مورد
            {onlyLowConfidence ? " (فقط اطمینان پایین)" : ""}
          </p>
        )}
        {refineError && <p role="alert" className="mt-3 shrink-0 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{refineError}</p>}
        <div className="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} className="size-4 accent-primary" />
            تفکیک گویندگان
          </label>
          {!loading && (
            <button
              onClick={() => void refineTranscript()}
              disabled={refining || segments.length === 0}
              aria-label="اصلاح املا و علائم نگارشی"
              className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
            >
              {refining ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
              {refining ? "در حال اصلاح…" : "اصلاح املا و علائم"}
            </button>
          )}
          {!loading && <button onClick={() => downloadSubtitle("srt")} aria-label="دانلود فایل زیرنویس SRT" className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"><Download className="size-4" aria-hidden="true" /> SRT</button>}
          {!loading && <button onClick={() => downloadSubtitle("txt")} aria-label="دانلود فایل متنی TXT" className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"><Download className="size-4" aria-hidden="true" /> TXT</button>}
          {!loading && <button onClick={() => void runAnalysis("quick")} disabled={analyzing || segments.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50">{analyzing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}{analyzing ? "در حال تحلیل…" : "تحلیل متن"}</button>}
          <button onClick={copy} disabled={segments.length === 0} aria-label="کپی متن" className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">{copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}{copied ? "کپی شد" : "کپی"}</button>
        </div>
      </div>
    </div>
  ) : null;

  const analysisPanel = (
    <>
      {analysisError && <div className="min-w-0 whitespace-pre-wrap rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive sm:p-5">{analysisError}</div>}
      {analysis && (
        <details open className="panel group min-w-0 overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-4 sm:px-6">
            <span className="flex min-w-0 items-center gap-2 text-base font-bold sm:text-lg"><Sparkles className="size-5 shrink-0 text-primary" />{analysisMode === "full" ? "گزارش تحلیل کامل" : "تحلیل متن"}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border px-3 pb-5 pt-4 sm:px-6">
            <div className="mb-4 flex flex-wrap justify-end gap-2">
              <button onClick={() => void runAnalysis("quick")} disabled={analyzing || segments.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50">{analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}تحلیل سریع</button>
              <button onClick={() => void runAnalysis("full")} disabled={analyzing || segments.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50" title="بررسی بخش‌به‌بخش و گزارش کامل">{analyzing ? <Loader2 className="size-4 animate-spin" /> : <FileSearch className="size-4" />}تحلیل کامل</button>
              <button onClick={copyAnalysis} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">{analysisCopied ? <Check className="size-4" /> : <Copy className="size-4" />}{analysisCopied ? "کپی شد" : "کپی"}</button>
              <button onClick={clearAnalysis} className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-secondary"><Trash2 className="size-4" /> بستن</button>
            </div>
            <div className="min-w-0 whitespace-pre-wrap break-words rounded-xl border border-border bg-surface p-3 text-base leading-9 sm:p-4">{analysis}</div>
          </div>
        </details>
      )}
    </>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full min-w-0 max-w-7xl flex-col gap-6 overflow-x-hidden px-2.5 py-8 sm:px-3 sm:py-12">
      <a href="#transcript" className="sr-only-focusable rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">پرش به خروجی متن</a>
      <p aria-live="polite" className="sr-only">{status}</p>
      <header className="min-w-0 text-center">
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setShowShortcuts((v) => !v)} aria-expanded={showShortcuts} aria-label="راهنمای میانبرهای صفحه‌کلید" title="میانبرهای صفحه‌کلید (?)" className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-primary hover:text-primary-foreground">
            <Keyboard className="size-5" aria-hidden="true" />
          </button>
          <ThemeToggle />
        </div>
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">VoicePluss</h1>
        <p className="mx-auto mt-4 max-w-xl px-1 text-base leading-8 text-muted-foreground">VoicePluss — ضبط یا آپلود صوت/ویدیو و دریافت متن فارسی یا انگلیسی. فایل‌های طولانی به‌صورت خودکار تقسیم و متن‌ها ادغام می‌شوند.</p>
        {showShortcuts && (
          <ul className="panel mx-auto mt-4 max-w-md space-y-1.5 p-4 text-right text-sm">
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">Space</kbd> — پخش / توقف</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">→</kbd> — ۱۰ ثانیه جلو</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">←</kbd> — ۱۰ ثانیه عقب</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">Ctrl+S</kbd> — ذخیرهٔ فایل متنی</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">Ctrl+E</kbd> — ذخیرهٔ فایل زیرنویس</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">?</kbd> — نمایش همین راهنما</li>
          </ul>
        )}
      </header>
      {hasTranscript ? (
        <div id="transcript" className="grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.95fr)]" dir="ltr">
          <div dir="rtl" className="order-2 flex min-w-0 w-full flex-col gap-6 lg:order-1">{textPanel}{analysisPanel}</div>
          <div dir="rtl" className="order-1 min-w-0 w-full lg:order-2">{controlsColumn}</div>
        </div>
      ) : (
        <div className="mx-auto w-full min-w-0 max-w-3xl">{controlsColumn}</div>
      )}
      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">VoicePluss — فایل‌ها فقط برای پردازش ارسال می‌شوند. از ویدیو فقط صوت استخراج می‌شود.</footer>
    </main>
  );
}
