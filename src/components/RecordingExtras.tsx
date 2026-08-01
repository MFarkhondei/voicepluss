import { useEffect } from "react";

/**
 * - Hides «تفکیک گویندگان»
 * - Places «دانلود صوت ضبط‌شده» once on the playback-speed row
 *   (does NOT keep rewriting the row — that was closing the speed dropdown)
 */
export function RecordingExtras() {
  useEffect(() => {
    let cancelled = false;
    let placedForSrc = "";

    const hideDiarize = () => {
      document.querySelectorAll("label").forEach((lab) => {
        const t = (lab.textContent || "").replace(/\s+/g, " ").trim();
        if (!t.includes("تفکیک گویندگان")) return;
        (lab as HTMLElement).style.display = "none";
        const input = lab.querySelector(
          'input[type="checkbox"]',
        ) as HTMLInputElement | null;
        if (input?.checked) {
          input.checked = false;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    };

    const findRateRow = (): HTMLElement | null => {
      const detailsList = Array.from(document.querySelectorAll("details"));
      const player =
        detailsList.find((d) => {
          const t = d.querySelector("summary")?.textContent || "";
          return t.includes("پخش صوت") || t.includes("recording");
        }) || null;
      const scope: ParentNode = player || document;

      for (const sel of Array.from(scope.querySelectorAll("select"))) {
        const texts = Array.from(sel.options).map((o) => o.textContent || "");
        const isRate =
          sel.options.length >= 3 &&
          texts.some(
            (t) =>
              t.includes("عادی") ||
              t.includes("×") ||
              t.includes("1.25") ||
              t.includes("0.5") ||
              t.includes("1.5"),
          );
        if (!isRate) continue;
        let el: HTMLElement | null = sel.parentElement;
        for (let i = 0; i < 4 && el; i++) {
          const cls = el.className || "";
          if (cls.includes("flex") && cls.includes("items-center")) return el;
          el = el.parentElement;
        }
        return sel.parentElement as HTMLElement;
      }
      return null;
    };

    const isRecordingPlayer = (): boolean => {
      const summaries = Array.from(document.querySelectorAll("summary"));
      if (
        summaries.some((s) => (s.textContent || "").includes("recording.wav"))
      ) {
        sessionStorage.setItem("vp-had-recording", "1");
        return true;
      }
      return (
        sessionStorage.getItem("vp-had-recording") === "1" &&
        !!(document.querySelector("audio") as HTMLAudioElement | null)?.src
      );
    };

    const trackMic = () => {
      document.querySelectorAll("button").forEach((b) => {
        const al = b.getAttribute("aria-label") || "";
        if (!al.includes("توقف ضبط") && !al.includes("شروع ضبط")) return;
        if ((b as HTMLElement).dataset.vpMicHook) return;
        (b as HTMLElement).dataset.vpMicHook = "1";
        b.addEventListener(
          "click",
          () => {
            if ((b.getAttribute("aria-label") || "").includes("توقف")) {
              sessionStorage.setItem("vp-had-recording", "1");
              placedForSrc = ""; // allow re-place after new recording
            }
          },
          { capture: true },
        );
      });
    };

    const placeDownloadOnce = () => {
      trackMic();
      const audio = document.querySelector("audio") as HTMLAudioElement | null;
      if (!audio?.src || !isRecordingPlayer()) {
        // Remove button if player gone
        if (!audio?.src) {
          document.querySelector("[data-vp-dl-rec]")?.remove();
          placedForSrc = "";
        }
        return;
      }

      // Already placed for this audio source — do nothing (keeps select open)
      if (placedForSrc === audio.src) {
        // Still ensure button exists (React may have re-rendered the row)
        if (document.querySelector("[data-vp-dl-rec]")) return;
        placedForSrc = "";
      }

      // Don't touch DOM while user is interacting with a select
      const active = document.activeElement;
      if (active && (active.tagName === "SELECT" || active.closest("select"))) {
        return;
      }

      const rateRow = findRateRow();
      if (!rateRow) return;

      // If button already in this row, mark and stop
      const existing = rateRow.querySelector(
        "[data-vp-dl-rec]",
      ) as HTMLButtonElement | null;
      if (existing) {
        placedForSrc = audio.src;
        return;
      }

      // Remove orphan buttons elsewhere
      document.querySelectorAll("[data-vp-dl-rec]").forEach((el) => el.remove());
      document
        .querySelectorAll("[data-vp-dl-rec-wrap]")
        .forEach((el) => el.remove());

      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.vpDlRec = "1";
      btn.className =
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-secondary";
      btn.title = "دانلود فایل صوتی ضبط‌شده";
      btn.setAttribute("aria-label", "دانلود صوت ضبط‌شده");
      btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg><span>دانلود صوت ضبط‌شده</span>';
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
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

      // One-time layout: space-between, download first (راست در RTL)
      rateRow.style.display = "flex";
      rateRow.style.width = "100%";
      rateRow.style.alignItems = "center";
      rateRow.style.justifyContent = "space-between";
      rateRow.style.gap = "0.5rem";

      // Wrap existing children once so select is not repeatedly moved
      if (!rateRow.querySelector("[data-vp-speed-group]")) {
        const speedGroup = document.createElement("span");
        speedGroup.dataset.vpSpeedGroup = "1";
        speedGroup.style.display = "inline-flex";
        speedGroup.style.alignItems = "center";
        speedGroup.style.gap = "0.5rem";
        while (rateRow.firstChild) {
          speedGroup.appendChild(rateRow.firstChild);
        }
        rateRow.appendChild(speedGroup);
      }

      const speedGroup = rateRow.querySelector(
        "[data-vp-speed-group]",
      ) as HTMLElement;
      rateRow.insertBefore(btn, rateRow.firstChild);
      if (speedGroup) rateRow.appendChild(speedGroup);

      placedForSrc = audio.src;
    };

    const tick = () => {
      if (cancelled) return;
      hideDiarize();
      placeDownloadOnce();
    };

    tick();
    // Slower poll; placement is idempotent and skips when select is focused
    const id = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
