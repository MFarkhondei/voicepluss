import { useCallback, useEffect, useRef, useState } from "react";

type WaveformProps = {
  peaks: number[];
  progress: number; // 0..1
  loading?: boolean;
  duration?: number;
  onSeek: (ratio: number) => void;
  /** Optional relative skip in seconds (e.g. ±10) */
  onSkip?: (deltaSeconds: number) => void;
  skipSeconds?: number;
};

const PLACEHOLDER_BARS = 90;
const EDGE_RATIO = 0.22; // left/right edge zones for relative skip

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/** نمودار موج واقعی با امکان کلیک و کشیدن (scrub) برای پرش به زمان دلخواه */
export function Waveform({
  peaks,
  progress,
  loading,
  duration = 0,
  onSeek,
  onSkip,
  skipSeconds = 10,
}: WaveformProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const isPlaceholder = loading || peaks.length === 0;
  const bars = isPlaceholder ? Array.from({ length: PLACEHOLDER_BARS }, () => 0.3) : peaks;

  const ratioFromX = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => onSeek(ratioFromX(e.clientX));
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, onSeek, ratioFromX]);

  const step = (delta: number) => onSeek(Math.min(1, Math.max(0, progress + delta)));

  return (
    <div
      ref={ref}
      dir="ltr"
      role="slider"
      aria-label="نمودار موج صوتی — وسط: پرش به زمان؛ سمت چپ: عقب؛ سمت راست یا کلیک راست: جلو"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={`${formatTime(progress * duration)} از ${formatTime(duration)}`}
      aria-busy={isPlaceholder || undefined}
      tabIndex={0}
      onContextMenu={(e) => {
        if (isPlaceholder || !onSkip) return;
        e.preventDefault();
        onSkip(skipSeconds);
      }}
      onPointerDown={(e) => {
        if (isPlaceholder) return;
        // Right mouse button → forward
        if (e.button === 2 && onSkip) {
          e.preventDefault();
          onSkip(skipSeconds);
          return;
        }
        if (e.button !== 0) return;
        const ratio = ratioFromX(e.clientX);
        // Left edge → skip back; right edge → skip forward; center → absolute seek
        if (onSkip && ratio <= EDGE_RATIO) {
          e.preventDefault();
          onSkip(-skipSeconds);
          return;
        }
        if (onSkip && ratio >= 1 - EDGE_RATIO) {
          e.preventDefault();
          onSkip(skipSeconds);
          return;
        }
        e.preventDefault();
        setDragging(true);
        onSeek(ratio);
      }}
      onPointerMove={(e) => !isPlaceholder && setHover(ratioFromX(e.clientX))}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          if (onSkip) onSkip(skipSeconds);
          else step(0.02);
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (onSkip) onSkip(-skipSeconds);
          else step(-0.02);
        }
        if (e.key === "Home") {
          e.preventDefault();
          onSeek(0);
        }
        if (e.key === "End") {
          e.preventDefault();
          onSeek(1);
        }
      }}
      className={`relative flex h-20 w-full touch-none select-none items-center gap-[2px] overflow-hidden rounded-xl bg-surface px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${isPlaceholder ? "cursor-progress" : "cursor-pointer"}`}
    >
      {bars.map((v, i) => {
        const played = bars.length > 1 ? i / (bars.length - 1) <= progress : false;
        return (
          <span
            key={i}
            className={
              isPlaceholder
                ? "flex-1 animate-pulse rounded-full bg-muted-foreground/20"
                : `flex-1 rounded-full transition-colors ${played ? "bg-primary" : "bg-muted-foreground/40"}`
            }
            style={{ height: `${Math.max(10, v * 100)}%`, minWidth: "2px" }}
          />
        );
      })}
      {!isPlaceholder && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-foreground/70"
          style={{ left: `calc(${Math.min(100, Math.max(0, progress * 100))}% - 1px)` }}
        />
      )}
      {!isPlaceholder && hover != null && duration > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background"
          style={{ left: `${hover * 100}%` }}
        >
          {formatTime(hover * duration)}
        </span>
      )}
    </div>
  );
}
