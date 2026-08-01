import { useEffect } from "react";

/**
 * Force layout:
 *   راست: آپلود صوت یا ویدیو
 *   وسط: زبان خروجی
 *   چپ: وضعیت سرویس
 */
export function HealthBadgeLayout() {
  useEffect(() => {
    const PLACE = "data-vp-bar";

    const arrange = () => {
      const health = document.querySelector(
        'button[title*="تست سرویس Groq"]',
      ) as HTMLButtonElement | null;
      if (!health) return;

      const upload = Array.from(document.querySelectorAll("label")).find((l) =>
        (l.textContent || "").includes("آپلود صوت"),
      ) as HTMLElement | undefined;
      if (!upload) return;

      // Language block: nearest ancestor div that contains the language <select>
      let language: HTMLElement | null = null;
      const selects = Array.from(document.querySelectorAll("select"));
      for (const sel of selects) {
        const opts = Array.from(sel.options).map((o) => o.textContent || "");
        if (opts.some((t) => t.includes("فارسی") || t.includes("English"))) {
          language = sel.parentElement as HTMLElement;
          break;
        }
      }
      if (!language) return;

      // Prefer reusing the existing bottom row that already holds upload
      let bar = upload.parentElement as HTMLElement | null;
      if (!bar) return;

      // If bar is not marked yet, restyle it as the three-item row
      if (!bar.hasAttribute(PLACE)) {
        bar.setAttribute(PLACE, "1");
        bar.className =
          "flex w-full min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border pt-5";
      }

      // Order in DOM for RTL + justify-between:
      // first = right, last = left
      if (upload.parentElement !== bar) bar.appendChild(upload);
      if (language.parentElement !== bar) bar.appendChild(language);
      if (health.parentElement !== bar) bar.appendChild(health);

      // Explicit order every time (React may shuffle)
      bar.insertBefore(upload, bar.firstChild);
      if (upload.nextSibling !== language) {
        bar.insertBefore(language, upload.nextSibling);
      }
      if (language.nextSibling !== health) {
        bar.appendChild(health);
      }

      upload.classList.add("shrink-0");
      language.classList.add("shrink-0");
      health.classList.add("shrink-0");
      health.style.marginTop = "0";
      health.title = "تست سرویس Groq — برای بررسی دوباره کلیک کنید";

      // Shorten label so it fits on one row on mobile
      const labelSpan = health.querySelector("span.truncate");
      if (labelSpan && health.dataset.shortened !== "1") {
        // leave text as-is; truncation handles overflow
        health.dataset.shortened = "1";
      }
    };

    arrange();
    const id = window.setInterval(arrange, 400);
    const obs = new MutationObserver(arrange);
    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearInterval(id);
      obs.disconnect();
    };
  }, []);

  return null;
}
