import { useEffect } from "react";

/**
 * Moves the Groq health badge from above the mic to the left of the upload button (RTL).
 * Keeps index.tsx untouched to avoid large-file push issues.
 */
export function HealthBadgeLayout() {
  useEffect(() => {
    let tries = 0;
    const maxTries = 40;

    const move = () => {
      const health = document.querySelector(
        'button[title="تست سرویس Groq"]',
      ) as HTMLElement | null;
      if (!health) return false;

      const labels = Array.from(document.querySelectorAll("label"));
      const upload = labels.find((l) =>
        (l.textContent || "").includes("آپلود صوت"),
      ) as HTMLElement | undefined;
      if (!upload) return false;

      // Already placed next to upload
      if (health.previousElementSibling === upload || health.nextElementSibling === upload) {
        return true;
      }

      let row = upload.parentElement;
      if (!row) return false;

      // Prefer wrapping upload + health in a flex group if the parent is the full row
      const hasLanguage = row.querySelector("select");
      if (hasLanguage && row.children.length >= 2) {
        let group = row.querySelector("[data-health-upload-group]") as HTMLElement | null;
        if (!group) {
          group = document.createElement("div");
          group.setAttribute("data-health-upload-group", "1");
          group.className =
            "flex min-w-0 flex-wrap items-center justify-center gap-2 sm:justify-start";
          row.insertBefore(group, upload);
          group.appendChild(upload);
        }
        // In RTL flex: first = right, second = left of first → health after upload = left of upload
        group.appendChild(health);
      } else {
        upload.insertAdjacentElement("afterend", health);
      }

      health.title = "تست سرویس Groq — برای بررسی دوباره کلیک کنید";
      return true;
    };

    const tick = () => {
      if (move() || ++tries >= maxTries) return;
      window.setTimeout(tick, 250);
    };
    tick();

    const obs = new MutationObserver(() => {
      move();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return () => obs.disconnect();
  }, []);

  return null;
}
