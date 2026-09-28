// پخش یک صدای تقریباً بی‌صدا در حلقه، تا مرورگر موبایل (مثل پخش موسیقی)
// صفحه را هنگام رفتن به پس‌زمینه متوقف نکند و تبدیل به متن ادامه پیدا کند.
// باید اولین بار از داخل کلیک کاربر صدا زده شود.

let el: HTMLAudioElement | null = null;
let url: string | null = null;

function makeSilentWav(): string {
  const rate = 8000;
  const n = rate; // ۱ ثانیه
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  // نویز بسیار ضعیف (کاملاً صفر را بعضی مرورگرها «پخش» حساب نمی‌کنند)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, (i % 2 ? 1 : -1), true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export function startKeepAlive(title = "در حال تبدیل به متن…") {
  if (typeof window === "undefined") return;
  try {
    if (!url) url = makeSilentWav();
    if (!el) {
      el = new Audio(url);
      el.loop = true;
      el.volume = 0.01;
      el.setAttribute("playsinline", "");
    }
    void el.play().catch(() => {});
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "VoicePluss" });
    }
  } catch { /* best-effort */ }
}

export function stopKeepAlive() {
  try { el?.pause(); } catch { /* ignore */ }
}
