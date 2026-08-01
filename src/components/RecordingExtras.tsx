import { useEffect } from "react";

/**
 * - Hides the «تفکیک گویندگان» checkbox
 * - Adds «دانلود صوت ضبط‌شده» on the same row as playback speed (marked area)
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
          const input = lab.querySelector(
            'input[type="checkbox"]',
          ) as HTMLInputElement | null;
          if (input && input.checked) {
            input.checked = false;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
    };

    const findRateRow = (root: ParentNode): HTMLElement | null => {
      // Row that contains the playback-rate <select> (options like ۱× عادی)
      const selects = Array.from(root.querySelectorAll("select"));
      for (const sel of selects) {
        const opts = Array.from(sel.options).map((o) => o.textContent || "");
        if (opts.some((t) => t.includes("عادی") || t.includes("1×") || t.includes("۱×"))) {
          return sel.parentElement as HTMLElement;
        }
      }
      return null;
    };

    const ensureDownloadBtn = () => {
      const summaries = Array.from(document.querySelectorAll("summary"));
      const recSummary = summaries.find((s) =>
        (s.textContent || "").includes("recording.wav"),
      );
      const audio = document.querySelector("audio") as HTMLAudioElement | null;

      const micBtns = Array.from(document.querySelectorAll("button"));
      for (const b of micBtns) {
        const al = b.getAttribute("aria-label") || "";
        if (al.includes("توقف ضبط")) {
          sessionStorage.setItem("vp-had-recording", "1");
        }
      }

      const fromSession = sessionStorage.getItem("vp-had-recording") === "1";
      const show = !!audio?.src && !!recSummary && fromSession;

      // Remove old top-of-panel placement if any
      document.querySelectorAll("[data-vp-dl-rec-wrap]").forEach((el) => el.remove());

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
          "inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-secondary";
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

      const playerPanel = recSummary?.parentElement;
      const body = playerPanel?.querySelector(".border-t") as HTMLElement | null;
      if (!body) return;

      const rateRow = findRateRow(body);
      if (!rateRow) return;

      // Make the rate row a full-width bar: download (right in RTL) · speed (left)
      rateRow.className =
        "mb-3 flex w-full min-w-0 items-center justify-between gap-2 text-sm";

      // Group existing speed controls so they stay together on one side
      let speedGroup = rateRow.querySelector(
        "[data-vp-speed-group]",
      ) as HTMLElement | null;
      if (!speedGroup) {
        speedGroup = document.createElement("div");
        speedGroup.dataset.vpSpeedGroup = "1";
        speedGroup.className = "inline-flex items-center gap-2";
        // Move current children (gauge + select) into the group
        while (rateRow.firstChild) {
          speedGroup.appendChild(rateRow.firstChild);
        }
        rateRow.appendChild(speedGroup);
      }

      // DOM order in RTL + justify-between:
      // first child → راست، last → چپ
      // دانلود (راست، محل مشخص‌شده) · سرعت (چپ)
      if (btn.parentElement !== rateRow) {
        rateRow.insertBefore(btn, rateRow.firstChild);
      } else if (rateRow.firstChild !== btn) {
        rateRow.insertBefore(btn, rateRow.firstChild);
      }
      if (speedGroup.parentElement === rateRow) {
        rateRow.appendChild(speedGroup);
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
