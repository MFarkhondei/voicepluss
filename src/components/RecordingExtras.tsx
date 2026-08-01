import { useEffect } from "react";

/**
 * - Hides the «تفکیک گویندگان» checkbox
 * - Adds «دانلود صوت ضبط‌شده» when the player is showing an in-app recording
 */
export function RecordingExtras() {
  useEffect(() => {
    let cancelled = false;

    const hideDiarize = () => {
      const labels = Array.from(document.querySelectorAll("label"));
      for (const lab of labels) {
        const t = (lab.textContent || "").replace(/\s+/g, " ").trim();
        if (t.includes("تفکیک گویندگان")) {
          (lab as HTMLElement).style.display = "none";
          const input = lab.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          if (input && input.checked) {
            input.checked = false;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
    };

    const ensureDownloadBtn = () => {
      // In-app recording is named recording.wav in the player summary
      const summaries = Array.from(document.querySelectorAll("summary"));
      const recSummary = summaries.find((s) =>
        (s.textContent || "").includes("recording.wav"),
      );
      const audio = document.querySelector("audio") as HTMLAudioElement | null;
      const hasRec =
        !!recSummary ||
        (!!audio?.src &&
          (audio.src.startsWith("blob:") &&
            (document.body.innerText.includes("recording.wav") ||
              !!sessionStorage.getItem("vp-had-recording"))));

      // Mark when user was recording (mic button toggles)
      const micBtns = Array.from(document.querySelectorAll("button"));
      for (const b of micBtns) {
        const al = b.getAttribute("aria-label") || "";
        if (al.includes("توقف ضبط")) {
          sessionStorage.setItem("vp-had-recording", "1");
        }
      }

      const fromSession = sessionStorage.getItem("vp-had-recording") === "1";
      const show = !!audio?.src && (hasRec || fromSession) && !!recSummary;

      let btn = document.querySelector(
        "[data-vp-dl-rec]",
      ) as HTMLButtonElement | null;

      if (!show) {
        if (btn) btn.remove();
        return;
      }

      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.vpDlRec = "1";
        btn.className =
          "inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary";
        btn.title = "دانلود فایل صوتی ضبط‌شده";
        btn.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg><span>دانلود صوت ضبط‌شده</span>';
        btn.addEventListener("click", () => {
          const a = document.querySelector("audio") as HTMLAudioElement | null;
          if (!a?.src) return;
          const link = document.createElement("a");
          link.href = a.src;
          link.download = `voicepluss-recording-${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, "-")}.wav`;
          document.body.appendChild(link);
          link.click();
          link.remove();
        });
      }

      // Place above the playback-rate row inside the player panel
      const playerPanel = recSummary?.parentElement;
      const body = playerPanel?.querySelector(
        ".border-t",
      ) as HTMLElement | null;
      if (body && btn.parentElement !== body) {
        const wrap = document.createElement("div");
        wrap.dataset.vpDlRecWrap = "1";
        wrap.className = "mb-3 flex justify-end";
        wrap.appendChild(btn);
        const existing = body.querySelector("[data-vp-dl-rec-wrap]");
        if (existing) existing.remove();
        body.insertBefore(wrap, body.firstChild);
      }
    };

    const tick = () => {
      if (cancelled) return;
      hideDiarize();
      ensureDownloadBtn();
    };

    tick();
    const id = window.setInterval(tick, 800);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
