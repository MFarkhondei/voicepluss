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
  Keyboard,
  Languages,
  Repeat,
  Settings,
  ListMusic,
  X,
  Clock,
  FileText,
  FileAudio,
} from "lucide-react";
import { encodeWav } from "@/lib/wav";
import { toSrt, toTxt, downloadText, parseSrt } from "@/lib/subtitles";
import { prepareAudioForTranscription, DEFAULT_PART_MINUTES } from "@/lib/splitAudio";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  listLibrary,
  getLibraryItem,
  putLibraryItem,
  updateLibraryItem,
  deleteLibraryItem,
  makeLibraryId,
  formatLibraryDate,
  type LibraryMeta,
} from "@/lib/library";

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
  seg, index, isActive, isPlaying, hasAudio, cardRef, onSeek, onPlayOnly, onTogglePlay, onChange, onEditStart,
}: {
  seg: Segment; index: number; isActive: boolean; isPlaying: boolean; hasAudio: boolean;
  cardRef?: (el: HTMLLIElement | null) => void;
  onSeek: (t: number) => void; onPlayOnly: (s: Segment, i: number) => void; onTogglePlay: () => void;
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
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, [draft]);

  const translate = useCallback(async () => {
    const value = draft.trim();
    if (!value || translating) return;
    // Stop audio playback immediately when the translate button is pressed.
    onEditStart?.();
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
  }, [draft, translating, onEditStart]);

  const baseClass = isActive
    ? "border-primary bg-primary/10 ring-1 ring-primary/40"
    : low
      ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/15"
      : "border-transparent bg-surface hover:bg-secondary/60";
  return (
    <li ref={cardRef} aria-current={isActive ? "true" : undefined} className={`scroll-mt-4 rounded-xl border p-3 text-sm transition-colors ${baseClass}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
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
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <button type="button" onClick={() => onSeek(seg.start)} aria-label={`پرش به دقیقه ${formatTime(seg.start)}`} className="pt-1 font-mono text-xs text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" title="پرش به این بخش">{formatTime(seg.start)}</button>
          <button
            type="button"
            onClick={() => (isPlaying ? onTogglePlay() : onPlayOnly(seg, index))}
            disabled={!hasAudio}
            aria-label={isPlaying ? "توقف پخش" : "پخش متن جاری"}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            title={isPlaying ? "توقف پخش" : "پخش متن جاری"}
          >
            {isPlaying ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => void translate()} disabled={translating || !draft.trim()} aria-label="ترجمه به فارسی" className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40" title="ترجمه به فارسی">
            {translating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Languages className="size-4" aria-hidden="true" />}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <textarea ref={taRef} value={draft} aria-label={`متن بخش ${index + 1} از دقیقه ${formatTime(seg.start)}`} onFocus={() => { onEditStart?.(); setEditing(true); }} onChange={(e) => { setDraft(e.target.value); onChange(index, e.target.value); }} onBlur={() => setEditing(false)} rows={3} wrap="soft" style={{ minHeight: "72px" }} className="block w-full resize-none overflow-hidden rounded-lg border border-transparent bg-transparent p-1.5 text-right text-sm leading-6 outline-none focus:overflow-x-auto focus:border-border focus:bg-card focus:ring-2 focus:ring-ring" dir="rtl" />
          {translation ? (
            <p dir="rtl" className="mt-1.5 rounded-lg border border-accent/30 bg-accent/10 p-2 text-right text-sm leading-7">{translation}</p>
          ) : null}
          {translateError ? (
            <p dir="rtl" className="mt-1.5 text-right text-xs text-destructive">{translateError}</p>
          ) : null}
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
  const [playbackRate, setPlaybackRate] = useState(() => {
    try {
      const v = Number(localStorage.getItem("vp_playbackRate"));
      return PLAYBACK_RATES.includes(v) ? v : 1;
    } catch {
      return 1;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "inf" | "1" | "2" | "3" | "4" | "5">(() => {
    try {
      const v = localStorage.getItem("vp_repeatMode");
      if (v === "off" || v === "inf" || ["1","2","3","4","5"].includes(v)) return v as any;
    } catch {}
    return "off";
  });

  const isMobile = useIsMobile();
  const [status, setStatus] = useState("");
  const [activeTab, setActiveTab] = useState<"upload" | "playlist" | "text">("upload");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [library, setLibrary] = useState<LibraryMeta[]>([]);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null);

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
  const playOnlyRef = useRef(false);

  const panelsRef = useRef<HTMLDivElement | null>(null);
  const textLockHRef = useRef<number | null>(null);
  const currentItemIdRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingPlayRef = useRef(false);
  const loadGenRef = useRef(0);
  const seekCleanupRef = useRef<(() => void) | null>(null);
  const lastSavedTimeRef = useRef(0);

  const setSourceFromBlob = useCallback((blob: Blob, opts?: { initialDuration?: number | null }) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    // Generic "audio/*" is not a valid media type for HTMLAudioElement in some browsers
    let srcBlob = blob;
    if ((blob.type || "").trim() === "audio/*") {
      srcBlob = new Blob([blob], { type: "audio/webm" });
    }
    const url = URL.createObjectURL(srcBlob);
    audioUrlRef.current = url;
    loadGenRef.current += 1;
    setAudioUrl(url);
    setPlaying(false);
    setCurrentTime(0);
    // Recordings (MediaRecorder webm blobs) often report duration as Infinity/NaN
    // until the browser finishes indexing them, which leaves the slider's max at 0
    // and makes it collapse to the end. Seed a known duration (saved earlier for this
    // library item) right away so the slider is usable immediately; onDurationChange
    // will correct it once the browser figures out the real value.
    const initialDur = opts?.initialDuration && opts.initialDuration > 0 ? opts.initialDuration : 0;
    setDuration(initialDur);
    // CRITICAL: clear leftover segment-stop state from previous play,
    // otherwise onTimeUpdate immediately jumps to an old stopAt (looks like EOF).
    stopAtRef.current = null;
    playOnlyRef.current = false;
    repeatIdxRef.current = null;
    repeatDoneRef.current = 0;
  }, []);

  useEffect(() => () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  const cancelJob = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; }, []);
  const clearAnalysis = useCallback(() => { setAnalysis(null); setAnalysisMode(null); setAnalysisError(null); }, []);

  // ————— پلی‌لیست: فایل‌های اجراشدهٔ قبلی از حافظهٔ مرورگر —————
  const refreshLibrary = useCallback(async () => {
    setLibrary(await listLibrary());
  }, []);
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);

  const rememberFile = useCallback(async (blob: Blob, name: string) => {
    const id = makeLibraryId();
    currentItemIdRef.current = id;
    setCurrentItemId(id);
    lastSavedTimeRef.current = 0;
    const now = Date.now();
    await putLibraryItem({
      id,
      name,
      createdAt: now,
      updatedAt: now,
      size: blob.size,
      type: blob.type || "audio/*",
      duration: null,
      lastTime: 0,
      text: "",
      segments: [],
      blob,
    });
    await refreshLibrary();
    return id;
  }, [refreshLibrary]);

  const openLibraryItem = useCallback(async (id: string) => {
    setLoadingItemId(id);
    try {
      const item = await getLibraryItem(id);
      if (!item) { await refreshLibrary(); return; }
      cancelJob();
      currentItemIdRef.current = id;
      setCurrentItemId(id);
      setError(null);
      setPendingFile(null);
      setSegmentQuery("");
      setOnlyLowConfidence(false);
      clearAnalysis();
      setFileName(item.name);
      setSegments(item.segments);
      setText(item.text);
      if (item.segments.length > 0) setActiveTab("text");
      // Resume from lastTime when safe; otherwise start from 0.
      // Never resume into the last ~1s (that looked like an instant jump to EOF).
      let resume = 0;
      const lt = Number(item.lastTime) || 0;
      const knownDur = item.duration && item.duration > 0 ? item.duration : null;
      if (lt > 1) {
        if (knownDur != null && (lt >= knownDur - 1 || lt / knownDur > 0.98)) {
          resume = 0;
        } else {
          resume = lt;
        }
      }
      pendingSeekRef.current = resume > 0 ? resume : null;
      lastSavedTimeRef.current = resume;
      pendingPlayRef.current = true;
      setSourceFromBlob(item.blob, { initialDuration: knownDur });
    } finally {
      setLoadingItemId(null);
    }
  }, [cancelJob, clearAnalysis, refreshLibrary, setSourceFromBlob]);

  const removeLibraryItem = useCallback(async (id: string) => {
    await deleteLibraryItem(id);
    if (currentItemIdRef.current === id) { currentItemIdRef.current = null; setCurrentItemId(null); }
    await refreshLibrary();
  }, [refreshLibrary]);

  const downloadLibraryAudio = useCallback(async (id: string, name: string) => {
    setDownloadingItemId(id);
    try {
      const item = await getLibraryItem(id);
      if (!item) return;
      const url = URL.createObjectURL(item.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingItemId(null);
    }
  }, []);

  const rememberProgress = useCallback((time: number) => {
    const id = currentItemIdRef.current;
    if (!id) return;
    if (Math.abs(time - lastSavedTimeRef.current) < 4) return;
    lastSavedTimeRef.current = time;
    void updateLibraryItem(id, { lastTime: time });
  }, []);


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
  useEffect(() => { try { localStorage.setItem("vp_playbackRate", String(playbackRate)); } catch {} }, [playbackRate]);
  useEffect(() => { try { localStorage.setItem("vp_repeatMode", repeatMode); } catch {} }, [repeatMode]);
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
    if (seekCleanupRef.current) {
      seekCleanupRef.current();
      seekCleanupRef.current = null;
    }
    pendingPlayRef.current = false;
    pendingSeekRef.current = null;
    const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (duration || 0);
    const next = Math.max(0, Math.min(total || 0, start));
    stopAtRef.current = stopAt;
    try { el.currentTime = next; } catch { /* ignore */ }
    setCurrentTime(next);
    void el.play().catch(() => setPlaying(false));
  }, [audioUrl, duration]);
  const playSegmentOnly = useCallback((s: Segment, i?: number) => {
    playOnlyRef.current = true;
    repeatIdxRef.current = typeof i === "number" ? i : null;
    repeatDoneRef.current = 0;
    playFrom(s.start, s.end);
  }, [playFrom]);
  const playSegmentContinue = useCallback((s: Segment, i?: number) => {
    playOnlyRef.current = false;
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
    if (el.paused) {
      playOnlyRef.current = false;
      if (repeatMode !== "off" && activeSegmentIndex >= 0 && segments[activeSegmentIndex]) {
        const s = segments[activeSegmentIndex];
        repeatIdxRef.current = activeSegmentIndex;
        repeatDoneRef.current = 0;
        stopAtRef.current = s.end;
      } else {
        stopAtRef.current = null;
        repeatIdxRef.current = null;
      }
      void el.play().catch(() => setPlaying(false));
    } else el.pause();
  }, [audioUrl, repeatMode, activeSegmentIndex, segments]);
  const pauseForEdit = useCallback(() => {
    const el = playerRef.current;
    if (!el || !audioUrl) return;
    if (!el.paused) {
      playOnlyRef.current = false;
      stopAtRef.current = null;
      el.pause();
    }
  }, [audioUrl]);
  const clearMediaControlState = useCallback(() => {
    stopAtRef.current = null;
    playOnlyRef.current = false;
    // keep repeatMode preference, but cancel an in-progress segment-repeat chain
    repeatIdxRef.current = null;
    repeatDoneRef.current = 0;
    pendingPlayRef.current = false;
    pendingSeekRef.current = null;
    if (seekCleanupRef.current) {
      seekCleanupRef.current();
      seekCleanupRef.current = null;
    }
  }, []);

  const safeDuration = useCallback((el?: HTMLAudioElement | null) => {
    const d1 = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const d2 = Number.isFinite(duration) && duration > 0 ? duration : 0;
    return d1 || d2 || 0;
  }, [duration]);

  const skip = useCallback((delta: number) => {
    const el = playerRef.current;
    if (!el) return;
    clearMediaControlState();
    const total = safeDuration(el);
    const next = Math.max(0, Math.min(total, (el.currentTime || 0) + delta));
    try { el.currentTime = next; } catch { /* ignore */ }
    setCurrentTime(next);
  }, [clearMediaControlState, safeDuration]);

  const seekTo = useCallback((time: number) => {
    const el = playerRef.current;
    if (!el) return;
    clearMediaControlState();
    const total = safeDuration(el);
    const t = Number(time);
    const next = Math.max(0, Math.min(total, Number.isFinite(t) ? t : 0));
    try { el.currentTime = next; } catch { /* ignore */ }
    setCurrentTime(next);
  }, [clearMediaControlState, safeDuration]);

  const goToSegment = useCallback((delta: number) => {
    if (segments.length === 0) return;
    const cur = activeSegmentIndex;
    const nextIdx = cur < 0
      ? (delta > 0 ? 0 : segments.length - 1)
      : Math.min(segments.length - 1, Math.max(0, cur + delta));
    const seg = segments[nextIdx];
    if (!seg) return;
    if (playing) playSegmentContinue(seg, nextIdx);
    else seekTo(seg.start);
  }, [segments, activeSegmentIndex, playing, playSegmentContinue, seekTo]);

  const goToAdjacentSegment = useCallback((direction: 1 | -1) => {
    if (segments.length === 0) return;
    const cur = activeSegmentIndex;
    const idx = cur < 0
      ? (direction > 0 ? 0 : segments.length - 1)
      : Math.max(0, Math.min(segments.length - 1, cur + direction));
    const s = segments[idx];
    if (!s) return;
    if (playing) playSegmentContinue(s, idx);
    else seekTo(s.start);
  }, [segments, activeSegmentIndex, playing, playSegmentContinue, seekTo]);

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
    setSourceFromBlob(blob);
    setLoading(true);
    setError(null);
    setText("");
    setSegments([]);
    setSegmentQuery("");
    setOnlyLowConfidence(false);
    setFileName(name);
    void rememberFile(blob, name);
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
      setActiveTab("text");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
      setProgressLabel(null);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [language, cancelJob, clearAnalysis, setSourceFromBlob, rememberFile]);

  // ذخیرهٔ خودکار متن و بخش‌ها روی آیتم فعلی پلی‌لیست
  useEffect(() => {
    const id = currentItemIdRef.current;
    if (!id) return;
    const t = setTimeout(() => {
      void updateLibraryItem(id, { text, segments, duration: duration || null }).then(() => refreshLibrary());
    }, 800);
    return () => clearTimeout(t);
  }, [text, segments, duration, refreshLibrary]);

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
    currentItemIdRef.current = null;
    setCurrentItemId(null);
    lastSavedTimeRef.current = 0;
    pendingSeekRef.current = null;
    pendingPlayRef.current = false;
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
      const audioFile = pendingFile;
      setSegments(parsed);
      setText(parsed.map((s) => s.text.trim()).filter(Boolean).join(" ").trim());
      setError(null);
      setPendingFile(null);
      setOnlyLowConfidence(false);
      setActiveTab("text");
      if (!currentItemIdRef.current && audioFile) await rememberFile(audioFile, audioFile.name);
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

  const healthDotClass =
    health.state === "ok" ? "bg-primary" : health.state === "error" ? "bg-destructive" : "animate-pulse bg-muted-foreground";
  const healthLabel =
    health.state === "ok" ? "سرویس فعال" : health.state === "error" ? "سرویس در دسترس نیست" : "در حال بررسی سرویس";

  const uploadPanel = (
    <div className="flex flex-col gap-3 p-3.5">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between px-3.5 py-3">
          <span className="text-sm font-medium">{recording ? `در حال ضبط… ${formatTime(elapsed)}` : "شروع ضبط و بارگذاری فایل"}</span>
        </div>
        <div className="flex flex-col items-center gap-2.5 px-3.5 pb-4">
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={loading}
            aria-label={recording ? "توقف ضبط" : "شروع ضبط"}
            className={`flex size-15 items-center justify-center rounded-full transition-all disabled:opacity-50 ${recording ? "recording-pulse bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground hover:scale-105"}`}
            style={{ boxShadow: recording ? undefined : "var(--shadow-glow)" }}
          >
            {recording ? <Square className="size-6" aria-hidden="true" /> : <Mic className="size-6" aria-hidden="true" />}
          </button>
          <p className="text-[13px] text-muted-foreground">{recording ? "برای پایان ضبط دوباره کلیک کنید" : "برای شروع ضبط کلیک کنید"}</p>
        </div>
        <div className="flex justify-center border-t border-border px-3.5 py-3.5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-4.5 py-2.5 text-[13px] font-medium transition-colors hover:bg-secondary">
            آپلود صوت یا ویدیو
            <Upload className="size-4" aria-hidden="true" />
            <input
              type="file"
              accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4,.mov,.mkv,.avi"
              className="hidden"
              disabled={loading}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        </div>
      </div>

      {pendingFile && !loading && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-accent/40 bg-card px-3.5 py-3.5">
          <div className="flex items-center gap-2.5">
            <FileAudio className="size-5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{pendingFile.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{(pendingFile.size / (1024 * 1024)).toFixed(1)} مگابایت — آماده برای تبدیل</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-muted-foreground">زبان خروجی</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as OutputLanguage)}
              disabled={loading}
              className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
              title="زبان متن خروجی"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">اگر فایل متن یا زیرنویس (SRT) دارید می‌توانید مستقیم بارگذاری کنید.</p>
          <div className="flex gap-2">
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs font-medium transition-colors hover:bg-secondary">
              <FileText className="size-4" aria-hidden="true" /> بارگذاری فایل متنی
              <input type="file" accept=".srt,.vtt,text/plain" className="hidden" onChange={(e) => void onSrtFile(e.target.files?.[0])} />
            </label>
            <button
              type="button"
              onClick={startTranscription}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Sparkles className="size-4" aria-hidden="true" /> تبدیل به متن
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-4 text-muted-foreground">
          <div className="flex items-center gap-2 text-[13px]">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            <span className="min-w-0 text-center">{progressLabel || `در حال تبدیل «${fileName}» به متن…`}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.max(4, progressPct)}%` }} />
          </div>
          <p className="text-[11px]">{progressPct}٪</p>
          <button type="button" onClick={cancelJob} className="text-[11px] text-destructive underline-offset-2 hover:underline">توقف پردازش</button>
        </div>
      )}

      {error && <div className="min-w-0 whitespace-pre-wrap rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive">{error}</div>}
    </div>
  );

  const playlistPanel = (
    <div className="flex flex-col gap-2 p-3.5">
      <p className="mb-0.5 text-xs text-muted-foreground">فایل‌های اخیر</p>
      {library.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">هنوز فایلی ذخیره نشده است.</p>
      ) : (
        <ul className="flex max-h-[15.5rem] flex-col gap-1.5 overflow-y-auto">
          {library.map((item) => {
            const active = item.id === currentItemId;
            return (
              <li key={item.id}>
                <div className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 transition-colors ${active ? "border border-accent/40 bg-accent/10" : "border border-transparent hover:bg-secondary/60"}`}>
                  <button
                    type="button"
                    onClick={() => void openLibraryItem(item.id)}
                    disabled={loading || loadingItemId === item.id}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-start disabled:opacity-60"
                    title="بارگذاری این فایل و متن آن"
                  >
                    <span className={`flex size-8.5 shrink-0 items-center justify-center rounded-full ${active ? "bg-accent text-accent-foreground" : "bg-surface text-muted-foreground"}`}>
                      {loadingItemId === item.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{item.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{formatLibraryDate(item.updatedAt)}</span>
                        {item.segments.length > 0 && <span>{item.segments.length} بخش متن</span>}
                        {item.lastTime > 1 && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" aria-hidden="true" /> ادامه از {formatTime(item.lastTime)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadLibraryAudio(item.id, item.name)}
                    disabled={downloadingItemId === item.id}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-60"
                    aria-label={`دانلود فایل صوتی ${item.name}`}
                    title="دانلود فایل صوتی"
                  >
                    {downloadingItemId === item.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeLibraryItem(item.id)}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`حذف ${item.name} از پلی‌لیست`}
                    title="حذف از حافظه"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 px-1 text-[11px] text-muted-foreground">فایل‌ها و متن‌ها فقط روی همین دستگاه ذخیره می‌شوند (۲۰ مورد آخر).</p>
    </div>
  );

  const analysisPanel = (
    <>
      {analysisError && <div className="min-w-0 whitespace-pre-wrap rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive">{analysisError}</div>}
      {analysis && (
        <details open className="overflow-hidden border-t border-border pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium">
            <span className="flex min-w-0 items-center gap-1.5"><Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden="true" />{analysisMode === "full" ? "گزارش تحلیل کامل" : "گزارش تحلیل"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button onClick={() => void runAnalysis("quick")} disabled={analyzing || segments.length === 0} className="flex-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-secondary disabled:opacity-50">تحلیل سریع</button>
            <button onClick={() => void runAnalysis("full")} disabled={analyzing || segments.length === 0} className="flex-1 rounded-lg border border-accent/40 px-2 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50">تحلیل کامل</button>
            <button onClick={copyAnalysis} className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-secondary">{analysisCopied ? "کپی شد" : "کپی"}</button>
            <button onClick={clearAnalysis} className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary">بستن</button>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface p-2.5 text-[12px] leading-7 text-secondary-foreground">{analysis}</p>
        </details>
      )}
    </>
  );

  const textPanel = (
    <div className="flex flex-col gap-2.5 p-3.5">
      {!hasTranscript ? (
        <p className="py-8 text-center text-sm text-muted-foreground">هنوز متنی تولید نشده است. از تب «بارگذاری» شروع کنید.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-[13px] font-medium">
              خروجی متن ({segments.length} بخش){loading ? <span className="mr-1.5 text-[11px] font-normal text-muted-foreground">(در حال تکمیل…)</span> : null}
            </span>
            {lowConfidenceCount > 0 ? (
              <button
                type="button"
                onClick={() => setOnlyLowConfidence((v) => !v)}
                aria-pressed={onlyLowConfidence}
                title={onlyLowConfidence ? "نمایش همه بخش‌ها" : "فقط بخش‌های با اطمینان پایین"}
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  onlyLowConfidence ? "bg-amber-500 text-white" : "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200"
                }`}
              >
                {onlyLowConfidence ? "نمایش همه" : `${lowConfidenceCount} اطمینان پایین`}
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <button onClick={copy} disabled={segments.length === 0} aria-label="کپی متن" className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
              {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}{copied ? "کپی شد" : "کپی"}
            </button>
            {!loading && <button onClick={() => downloadSubtitle("srt")} aria-label="دانلود فایل زیرنویس SRT" className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-secondary"><Download className="size-3.5" aria-hidden="true" /> SRT</button>}
            {!loading && <button onClick={() => downloadSubtitle("txt")} aria-label="دانلود فایل متنی TXT" className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-secondary"><Download className="size-3.5" aria-hidden="true" /> TXT</button>}
            {!loading && (
              <button onClick={() => void runAnalysis("quick")} disabled={analyzing || segments.length === 0} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-secondary disabled:opacity-50">
                {analyzing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}{analyzing ? "…" : "تحلیل"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Search className="pointer-events-none absolute mr-2.5 size-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={segmentQuery}
              onChange={(e) => setSegmentQuery(e.target.value)}
              placeholder="جستجو در جمله‌ها…"
              className="w-full min-w-0 rounded-lg border border-border bg-card py-2 pr-8 pl-3 text-[13px] outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {filteredSegments.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              {onlyLowConfidence && !segmentQuery.trim() ? "بخشی با اطمینان پایین یافت نشد." : "موردی یافت نشد."}
            </p>
          ) : (
            <ul ref={listRef} className="flex max-h-[13rem] min-w-0 flex-col gap-1.5 overflow-y-auto overflow-x-hidden">
              {filteredSegments.map(({ s, i }) => (
                <SegmentRow
                  key={i}
                  seg={s}
                  index={i}
                  isActive={i === activeSegmentIndex}
                  isPlaying={playing && i === activeSegmentIndex}
                  hasAudio={!!audioUrl}
                  cardRef={i === activeSegmentIndex ? (el) => { activeCardRef.current = el; } : undefined}
                  onSeek={seekTo}
                  onPlayOnly={playSegmentOnly}
                  onTogglePlay={togglePlay}
                  onChange={updateSegmentText}
                  onEditStart={pauseForEdit}
                />
              ))}
            </ul>
          )}
          {(segmentQuery.trim() || onlyLowConfidence) && (
            <p className="text-[11px] text-muted-foreground">
              {filteredSegments.length} از {segments.length} مورد{onlyLowConfidence ? " (فقط اطمینان پایین)" : ""}
            </p>
          )}

          {analysisPanel}
        </>
      )}
    </div>
  );


  const dockedPlayer = audioUrl && (
    <div className="border-t border-border bg-surface/60 px-3.5 pb-1.5 pt-2.5">
      <audio
        ref={playerRef}
        src={audioUrl}
        preload="auto"
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          const dur = Number.isFinite(el.duration) ? el.duration : 0;
          if (dur > 0) setDuration(dur);
          if (pendingPlayRef.current) return;
          const seek = pendingSeekRef.current;
          pendingSeekRef.current = null;
          if (seek != null && dur > 0 && seek > 0 && seek < dur - 0.5) {
            try {
              el.currentTime = seek;
              setCurrentTime(seek);
            } catch { /* ignore */ }
          }
        }}
        onCanPlay={(e) => {
          if (!pendingPlayRef.current) return;
          const gen = loadGenRef.current;
          pendingPlayRef.current = false;
          const el = e.currentTarget;
          stopAtRef.current = null;
          playOnlyRef.current = false;
          repeatIdxRef.current = null;
          repeatDoneRef.current = 0;

          const seek = pendingSeekRef.current;
          pendingSeekRef.current = null;

          const nativeDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
          const dur = nativeDur > 0 ? nativeDur : (Number.isFinite(duration) && duration > 0 ? duration : 0);
          if (nativeDur > 0) setDuration(nativeDur);

          let startAt = 0;
          if (seek != null && seek > 0) {
            startAt = dur > 0 && seek >= dur - 1 ? 0 : seek;
          }

          if (repeatMode !== "off" && segments.length > 0) {
            const repeatIndex = segments.findIndex((s) => startAt >= s.start && startAt < s.end);
            const idx = repeatIndex >= 0 ? repeatIndex : 0;
            const s = segments[idx];
            repeatIdxRef.current = idx;
            repeatDoneRef.current = 0;
            stopAtRef.current = s.end;
          }

          try { el.playbackRate = playbackRate; } catch { /* ignore */ }

          const doPlay = () => {
            if (loadGenRef.current !== gen) return;
            void el.play().catch(() => setPlaying(false));
          };

          if (startAt > 0.05) {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              if (seekCleanupRef.current) {
                seekCleanupRef.current();
                seekCleanupRef.current = null;
              }
              setCurrentTime(el.currentTime || startAt);
              doPlay();
            };
            const onSeeked = () => finish();
            el.addEventListener("seeked", onSeeked);
            const timer = window.setTimeout(finish, 500);
            seekCleanupRef.current = () => {
              el.removeEventListener("seeked", onSeeked);
              window.clearTimeout(timer);
            };
            try {
              el.currentTime = startAt;
              setCurrentTime(startAt);
            } catch {
              finish();
            }
          } else {
            try { el.currentTime = 0; } catch { /* ignore */ }
            setCurrentTime(0);
            doPlay();
          }
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          const t = el.currentTime || 0;
          const stopAt = stopAtRef.current;
          if (stopAt != null && t >= stopAt - 0.02) {
            stopAtRef.current = null;
            if (playOnlyRef.current) {
              playOnlyRef.current = false;
              repeatIdxRef.current = null;
              el.pause();
              try { el.currentTime = stopAt; } catch { /* ignore */ }
              setCurrentTime(stopAt);
              return;
            }
            const idx = repeatIdxRef.current;
            if (repeatMode !== "off" && idx != null && segments[idx]) {
              const limit = repeatMode === "inf" ? Number.POSITIVE_INFINITY : Number(repeatMode);
              repeatDoneRef.current += 1;
              if (repeatDoneRef.current < limit) {
                const s = segments[idx];
                stopAtRef.current = s.end;
                try { el.currentTime = s.start; } catch { /* ignore */ }
                setCurrentTime(s.start);
                void el.play().catch(() => setPlaying(false));
                return;
              }
              const next = segments[idx + 1];
              if (next) {
                repeatIdxRef.current = idx + 1;
                repeatDoneRef.current = 0;
                stopAtRef.current = next.end;
                try { el.currentTime = next.start; } catch { /* ignore */ }
                setCurrentTime(next.start);
                void el.play().catch(() => setPlaying(false));
                return;
              }
              repeatIdxRef.current = null;
            }
            el.pause();
            try { el.currentTime = stopAt; } catch { /* ignore */ }
            setCurrentTime(stopAt);
            return;
          }
          setCurrentTime(t);
          rememberProgress(t);
        }}
        onPlay={() => setPlaying(true)}
        onPause={(e) => {
          setPlaying(false);
          const id = currentItemIdRef.current;
          if (id) {
            const t = e.currentTarget.currentTime || 0;
            const dur = e.currentTarget.duration || 0;
            const saveT = dur > 0 && t >= dur - 0.5 ? 0 : t;
            lastSavedTimeRef.current = saveT;
            void updateLibraryItem(id, { lastTime: saveT });
          }
        }}
        onEnded={() => {
          setPlaying(false);
          stopAtRef.current = null;
          playOnlyRef.current = false;
          repeatIdxRef.current = null;
          const id = currentItemIdRef.current;
          if (id) {
            lastSavedTimeRef.current = 0;
            void updateLibraryItem(id, { lastTime: 0 });
          }
        }}
        className="hidden"
      />

      <p className="mb-2 truncate text-[13px] font-medium">{fileName}</p>

      <div dir="ltr" className="mb-2.5 flex items-center gap-2">
        <span className="w-9 shrink-0 text-[11px] tabular-nums text-accent">{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={Number.isFinite(duration) && duration > 0 ? duration : 0}
          step={0.1}
          value={Number.isFinite(currentTime) ? Math.min(Math.max(0, currentTime), Number.isFinite(duration) && duration > 0 ? duration : 0) : 0}
          onInput={(e) => seekTo(Number((e.target as HTMLInputElement).value))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
          aria-label="موقعیت پخش"
        />
        <span className="w-9 shrink-0 text-end text-[11px] tabular-nums text-accent">{formatTime(duration)}</span>
      </div>

      <div className="relative flex items-center justify-center pb-2.5">
        <div className="flex items-center justify-center gap-3.5">
          <button type="button" onClick={() => goToSegment(1)} disabled={segments.length === 0} aria-label="بخش بعدی" title="بخش بعدی" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40">
            <SkipForward className="size-3.5" aria-hidden="true" />
          </button>
          <button type="button" onClick={togglePlay} aria-label={playing ? "توقف" : "پخش"} className="inline-flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90">
            {playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="ml-0.5 size-5" aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => goToSegment(-1)} disabled={segments.length === 0} aria-label="بخش قبلی" title="بخش قبلی" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40">
            <SkipBack className="size-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="absolute right-0 top-1/2 -translate-y-1/2">
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="تنظیمات پخش"
            aria-expanded={settingsOpen}
            title="تنظیمات پخش"
            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary"
          >
            <Settings className="size-4" aria-hidden="true" />
          </button>
          {settingsOpen && (
            <div className="absolute bottom-full right-0 z-20 mb-2 w-52 rounded-2xl border border-border bg-card p-3 shadow-lg">
              <div className="mb-2 text-[12px] font-medium">تنظیمات پخش</div>
              <label className="mb-2 block text-[11px] text-muted-foreground">
                سرعت پخش
                <select
                  value={playbackRate}
                  onChange={(e) => setPlaybackRate(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-2.5 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-ring"
                >
                  {PLAYBACK_RATES.map((r) => <option key={r} value={r}>{r === 1 ? "عادی ×۱" : `×${r}`}</option>)}
                </select>
              </label>
              <label className="block text-[11px] text-muted-foreground">
                تعداد تکرار هر بخش
                <select
                  value={repeatMode}
                  onChange={(e) => { setRepeatMode(e.target.value as typeof repeatMode); repeatDoneRef.current = 0; }}
                  className={`mt-1 w-full rounded-xl border px-2.5 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-ring ${repeatMode !== "off" ? "border-accent/40 text-accent" : "border-border"}`}
                >
                  <option value="off">بدون تکرار</option>
                  <option value="2">۲ بار</option>
                  <option value="3">۳ بار</option>
                  <option value="4">۴ بار</option>
                  <option value="5">۵ بار</option>
                  <option value="inf">نامحدود</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => { setRepeatMode("off"); repeatDoneRef.current = 0; }}
                className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary"
              >
                <Gauge className="size-3.5" aria-hidden="true" />
                بازنشانی تکرار
              </button>
            </div>
          )}
        </div>
      </div>

    </div>
  );

  const tabs: { id: "upload" | "playlist" | "text"; label: string; icon: typeof Upload }[] = [
    { id: "upload", label: "بارگذاری", icon: Upload },
    { id: "playlist", label: "پلی‌لیست", icon: ListMusic },
    { id: "text", label: "متن خروجی", icon: FileText },
  ];

  return (
    <main className={`mx-auto flex min-h-dvh w-full min-w-0 flex-col gap-3 px-2.5 py-6 sm:py-10 ${isMobile ? "max-w-md" : "max-w-6xl"}`}>
      <a href="#vp-app" className="sr-only-focusable rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">پرش به برنامه</a>
      <p aria-live="polite" className="sr-only">{status}</p>

      <div id="vp-app" className="panel flex min-w-0 flex-col overflow-hidden rounded-[20px]">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-3">
          <button
            type="button"
            onClick={() => void runHealthCheck()}
            disabled={health.state === "checking"}
            title={health.message}
            className="inline-flex min-w-0 items-center gap-1.5"
          >
            <span className={`size-1.5 shrink-0 rounded-full ${healthDotClass}`} aria-hidden="true" />
            <span className="truncate text-[11px] text-muted-foreground">{healthLabel}</span>
          </button>
          <p className="text-[15px] font-medium">VoicePluss</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowShortcuts((v) => !v)}
              aria-expanded={showShortcuts}
              aria-label="میانبرها"
              title="میانبرهای صفحه‌کلید (?)"
              className="inline-flex size-6.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Keyboard className="size-3.5" aria-hidden="true" />
            </button>
            <ThemeToggle compact />
          </div>
        </div>

        {showShortcuts && (
          <ul className="space-y-1.5 border-b border-border px-3.5 py-3 text-right text-[12px] text-muted-foreground">
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">Space</kbd> — پخش / توقف</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">→</kbd> — ۱۰ ثانیه جلو</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">←</kbd> — ۱۰ ثانیه عقب</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">Ctrl+S</kbd> — ذخیرهٔ فایل متنی</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">Ctrl+E</kbd> — ذخیرهٔ فایل زیرنویس</li>
            <li><kbd className="rounded border border-border bg-surface px-1.5 font-mono">?</kbd> — نمایش همین راهنما</li>
          </ul>
        )}

        {isMobile ? (
          <>
            <div className="min-h-[300px]">
              {activeTab === "upload" && uploadPanel}
              {activeTab === "playlist" && playlistPanel}
              {activeTab === "text" && textPanel}
            </div>

            {dockedPlayer}

            <div className="flex border-t border-border">
              {tabs.map((t) => {
                const Icon = t.icon;
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors ${isActive ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Icon className="size-[19px]" aria-hidden="true" />
                    <span className="text-[11px]">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-3 items-stretch">
            <div className="h-[420px] min-w-0 overflow-y-auto">{uploadPanel}</div>
            <div className="flex h-[420px] min-w-0 flex-col border-s border-border">
              <div className="flex-1 overflow-y-auto">{playlistPanel}</div>
              {dockedPlayer}
            </div>
            <div className="h-[420px] min-w-0 overflow-y-auto border-s border-border">{textPanel}</div>
          </div>
        )}
      </div>

    </main>
  );
}
