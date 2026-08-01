import { useEffect } from "react";

/**
 * - Hides «تفکیک گویندگان»
 * - Places «دانلود صوت ضبط‌شده» on the playback-speed row (right side in RTL)
 */
export function RecordingExtras() {
  useEffect(() => {
    let cancelled = false;

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

    /** Find the flex row that holds the playback-rate select (inside player panel). */
    const findRateRow = (): HTMLElement | null => {
      // Prefer the open player details that mentions recording / پخش صوت
      const detailsList = Array.from(document.querySelectorAll("details"));
      const player =
        detailsList.find((d) => {
          const s = d.querySelector("summary");
          const t = s?.textContent || "";
          return t.includes("پخش صوت") || t.includes("recording");
        }) || null;

      const scope: ParentNode = player || document;

      for (const sel of Array.from(scope.querySelectorAll("select"))) {
        const texts = Array.from(sel.options).map((o) => o.textContent || "");
        const isRate =
          texts.some(
            (t) =>
              t.includes("عادی") ||
              t.includes("×") ||
              t.includes("x") ||
              t.includes("X") ||
              /[0-9۰-۹]\s*×/.test(t) ||
              t.trim() === "1" ||
              t.includes("1.25") ||
              t.includes("0.5"),
          ) && sel.options.length >= 3;
        if (!isRate) continue;
        // Climb to the horizontal flex row wrapping gauge + select
        let el: HTMLElement | null = sel.parentElement;
        for (let i = 0; i < 4 && el; i++) {
          const cls = el.className || "";
          if (cls.includes("flex") && (cls.includes("items-center") || cls.includes("gap"))) {
            return el;
          }
          el = el.parentElement;
        }
        return sel.parentElement as HTMLElement;
      }
      return null;
    };

    const isRecordingPlayer = (): boolean => {
      const summaries = Array.from(document.querySelectorAll("summary"));
      if (summaries.some((s) => (s.textContent || "").includes("recording.wav"))) {
        sessionStorage.setItem("vp-had-recording", "1");
        return true;
      }
      // Mic was used this session
      if (sessionStorage.getItem("vp-had-recording") === "1") {
        const audio = document.querySelector("audio") as HTMLAudioElement | null;
        return !!audio?.src;
      }
      return false;
    };

    // Track in-app recording start
    const trackMic = () => {
      document.querySelectorAll("button").forEach((b) => {
        const al = b.getAttribute("aria-label") || "";
        if (al.includes("توقف ضبط") || al.includes("شروع ضبط")) {
          if (!(b as HTMLElement).dataset.vpMicHook) {
            (b as HTMLElement).dataset.vpMicHook = "1";
            b.addEventListener(
              "click",
              () => {
                // Next stop will produce recording.wav; mark intent early
                if ((b.getAttribute("aria-label") || "").includes("توقف")) {
                  sessionStorage.setItem("vp-had-recording", "1");
                }
              },
              { capture: true },
            );
          }
        }
      });
    };

    const ensureDownloadBtn = () => {
      trackMic();

      const audio = document.querySelector("audio") as HTMLAudioElement | null;
      const show = !!audio?.src && isRecordingPlayer();

      // Clean previous standalone wraps
      document
        .querySelectorAll("[data-vp-dl-rec-wrap]")
        .forEach((el) => el.remove());

      let btn = document.querySelector(
        "[data-vp-dl-rec]",
      ) as HTMLButtonElement | null;

      if (!show) {
        btn?.remove();
        return;
      }

      const rateRow = findRateRow();
      if (!rateRow) return;

      if (!btn) {
        btn = document.createElement("button");
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
      }

      // Restyle rate row: space-between so download sits in the empty (right) slot
      rateRow.style.display = "flex";
      rateRow.style.width = "100%";
      rateRow.style.alignItems = "center";
      rateRow.style.justifyContent = "space-between";
      rateRow.style.gap = "0.5rem";
      rateRow.style.marginBottom = "0.75rem";

      // Bundle gauge + select if not already
      let speedGroup = rateRow.querySelector(
        "[data-vp-speed-group]",
      ) as HTMLElement | null;
      if (!speedGroup) {
        speedGroup = document.createElement("span");
        speedGroup.dataset.vpSpeedGroup = "1";
        speedGroup.style.display = "inline-flex";
        speedGroup.style.alignItems = "center";
        speedGroup.style.gap = "0.5rem";
        // Move non-download children into group
        const kids = Array.from(rateRow.childNodes);
        for (const node of kids) {
          if (node === btn || (node as HTMLElement).dataset?.vpDlRec) continue;
          if (node === speedGroup) continue;
          speedGroup.appendChild(node);
        }
        rateRow.appendChild(speedGroup);
      }

      // RTL + space-between: first = راست، last = چپ
      // Download goes first → appears on the right (red-box area)
      if (rateRow.firstChild !== btn) {
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
    const id = window.setInterval(tick, 600);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
