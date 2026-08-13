
/* playlist-audio-download-support */
async function downloadPlaylistAudio(audioUrl, filename = "audio") {
  if (!audioUrl) return;
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    // Fallback for sources that cannot be fetched due to browser/CORS restrictions.
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = filename;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}


/* playlist-download-support */
function downloadPlaylist(playlist, filename = "playlist.json") {
  try {
    const data = JSON.stringify(playlist, null, 2);
    const blob = new Blob([data], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Playlist download failed:", e);
  }
}

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

/** هر جمله در یک خط، بدون زمان */
export function toTxt(segments: Segment[]) {
  return (
    segments
      .map((seg) => seg.text.trim())
      .filter(Boolean)
      .join("\n") + "\n"
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

function parseStamp(v: string) {
  const m = v.trim().replace(",", ".").match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** خواندن فایل SRT یا VTT و تبدیل به سگمنت‌ها */
export function parseSrt(content: string): Segment[] {
  const blocks = content
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .replace(/^WEBVTT.*\n/, "")
    .split(/\n{2,}/);
  const out: Segment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const idx = lines.findIndex((l) => l.includes("-->"));
    if (idx === -1) continue;
    const [a, b] = lines[idx].split("-->");
    const text = lines.slice(idx + 1).join(" ").trim();
    if (!text) continue;
    out.push({ start: parseStamp(a), end: parseStamp(b), text });
  }
  return out;
}
