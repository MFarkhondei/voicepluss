import { useEffect } from "react";

/**
 * Arranges the bottom row of the record panel as:
 *   [آپلود]  [زبان خروجی]  [وضعیت سرویس]
 * In RTL that means: upload on the right, language in the middle, health on the left.
 */
export function HealthBadgeLayout() {
  useEffect(() => {
    let tries = 0;
    const maxTries = 48;
    let arranged = false;

    const arrange = () => {
      const health = document.querySelector(
        'button[title^="تست سرویس Groq"]',
      ) as HTMLElement | null;
      if (!health) return false;

      const labels = Array.from(document.querySelectorAll("label"));
      const upload = labels.find((l) =>
        (l.textContent || "").includes("آپلود صوت"),
      ) as HTMLElement | undefined;
      if (!upload) return false;

      const row = upload.parentElement;
      if (!row) return false;

      let language: HTMLElement | null = null;
      for (const child of Array.from(row.children)) {
        if (child === upload) continue;
        if ((child as HTMLElement).querySelector?.("select")) {
          language = child as HTMLElement;
          break;
        }
      }
      if (!language) {
        const spans = Array.from(document.querySelectorAll("span"));
        const langSpan = spans.find((s) =>
          (s.textContent || "").includes("زبان خروجی"),
        );
        language = (langSpan?.closest("div") as HTMLElement) || null;
      }

      let bar = document.querySelector(
        "[data-upload-lang-health]",
      ) as HTMLElement | null;

      if (!bar) {
        bar = document.createElement("div");
        bar.setAttribute("data-upload-lang-health", "1");
        bar.className =
          "flex w-full min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border pt-5";
        if (row.parentElement) {
          row.parentElement.insertBefore(bar, row);
        } else {
          upload.parentElement?.appendChild(bar);
        }
      }

      // DOM order in RTL + justify-between:
      // first → راست، last → چپ
      // آپلود (راست) · زبان (وسط) · وضعیت سرویس (چپ)
      if (language) {
        bar.appendChild(upload);
        bar.appendChild(language);
        bar.appendChild(health);
      } else {
        bar.appendChild(upload);
        bar.appendChild(health);
      }

      if (row !== bar && row.children.length === 0) {
        row.style.display = "none";
      }

      upload.classList.add("shrink-0");
      if (language) language.classList.add("shrink-0");
      health.classList.add("shrink-0");
      health.title = "تست سرویس Groq — برای بررسی دوباره کلیک کنید";

      arranged = true;
      return true;
    };

    const tick = () => {
      if (arrange() || ++tries >= maxTries) return;
      window.setTimeout(tick, 200);
    };
    tick();

    const obs = new MutationObserver(() => {
      if (!arranged) {
        arrange();
        return;
      }
      const health = document.querySelector(
        'button[title^="تست سرویس Groq"]',
      );
      const bar = document.querySelector("[data-upload-lang-health]");
      if (health && bar && health.parentElement !== bar) arrange();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return () => obs.disconnect();
  }, []);

  return null;
}
