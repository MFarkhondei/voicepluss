export type Segment = { start: number; end: number; text: string };

function pad(n: number, len = 2) {
  return Math.floor(n).toString().padStart(len, "0");
}

function stamp(sec: number, sep: "," | ".") {
  const h = pad(sec / 3600);
  const m = pad((sec % 3600) / 60);
  const s = pad(sec % 60);
  const ms = pad(Math.round((sec - Math.floor(sec)) * 1000), 3);
  return `${h}:${m}:${s}${sep}${ms}`;
}

export function toSrt(segments: Segment[]) {
  return (
    segments
      .map(
        (seg, i) =>
          `${i + 1}\n${stamp(seg.start, ",")} --> ${stamp(seg.end, ",")}\n${seg.text}`,
      )
      .join("\n\n") + "\n"
  );
}

export function toVtt(segments: Segment[]) {
  return (
    "WEBVTT\n\n" +
    segments
      .map((seg) => `${stamp(seg.start, ".")} --> ${stamp(seg.end, ".")}\n${seg.text}`)
      .join("\n\n") +
    "\n"
  );
}

export function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob(["\ufeff" + content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
