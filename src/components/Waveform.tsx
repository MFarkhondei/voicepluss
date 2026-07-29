type WaveformProps = {
  peaks: number[];
  progress: number; // 0..1
  loading?: boolean;
  onSeek: (ratio: number) => void;
};

const PLACEHOLDER_BARS = 90;

export function Waveform({ peaks, progress, loading, onSeek }: WaveformProps) {
  const bars = loading || peaks.length === 0
    ? Array.from({ length: PLACEHOLDER_BARS }, () => 0.3)
    : peaks;

  const handlePick = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width;
    onSeek(Math.min(1, Math.max(0, ratio)));
  };

  return (
    <div
      dir="ltr"
      role="slider"
      aria-label="موقعیت پخش"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
      onClick={(e) => handlePick(e.clientX, e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.02));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.02));
      }}
      className="flex h-16 w-full cursor-pointer items-center gap-[2px] rounded-xl bg-surface px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {bars.map((v, i) => {
        const played = bars.length > 1 ? i / (bars.length - 1) <= progress : false;
        return (
          <span
            key={i}
            className={
              loading || peaks.length === 0
                ? "flex-1 animate-pulse rounded-full bg-muted-foreground/20"
                : `flex-1 rounded-full transition-colors ${played ? "bg-primary" : "bg-muted-foreground/30"}`
            }
            style={{ height: `${Math.max(10, v * 100)}%`, minWidth: "2px" }}
          />
        );
      })}
    </div>
  );
}
