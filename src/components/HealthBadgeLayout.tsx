import { useEffect } from "react";

/**
 * Groq status dot under the panel collapse chevron.
 * - Green / red / gray by connection state
 * - Hover shows real status message (with latency when available)
 * - Click keeps native handler → re-runs health check
 */
export function HealthBadgeLayout() {
  useEffect(() => {
    let cancelled = false;
    let lastKey = "";

    const findHealth = (): HTMLButtonElement | null => {
      const marked = document.querySelector(
        "button[data-vp-dot='1']",
      ) as HTMLButtonElement | null;
      if (marked) return marked;

      const byTitle = document.querySelector(
        'button[title*="تست سرویس Groq"], button[title*="سرویس Groq"]',
      ) as HTMLButtonElement | null;
      if (byTitle) return byTitle;

      return (
        (Array.from(document.querySelectorAll("button")).find((b) => {
          const t = (b.textContent || "").trim();
          return (
            t.includes("سرویس") &&
            (t.includes("فعال") ||
              t.includes("بررسی") ||
              t.includes("دسترس") ||
              t.includes("اتصال") ||
              t.includes("میلی"))
          );
        }) as HTMLButtonElement | undefined) || null
      );
    };

    const readMessage = (health: HTMLButtonElement): string => {
      // Prefer live visible text before we strip it
      const live = (health.textContent || "").replace(/\s+/g, " ").trim();
      if (
        live &&
        !live.startsWith("در حال بررسی") &&
        live.length > 2 &&
        (live.includes("فعال") ||
          live.includes("نیست") ||
          live.includes("اتصال") ||
          live.includes("میلی") ||
          live.includes("خطا"))
      ) {
        health.dataset.vpMsg = live;
        return live;
      }

      // Kept from a previous successful read
      if (health.dataset.vpMsg) return health.dataset.vpMsg;

      // Class-based fallback
      if (health.className.includes("text-primary")) {
        return "سرویس Groq فعال است";
      }
      if (health.className.includes("text-destructive")) {
        return "سرویس در دسترس نیست";
      }
      return "در حال بررسی سرویس…";
    };

    const apply = () => {
      if (cancelled) return;
      const health = findHealth();
      if (!health) return;

      health.dataset.vpDot = "1";

      // Capture message BEFORE stripping label
      const msg = readMessage(health);

      const isOk =
        health.className.includes("text-primary") || msg.includes("فعال");
      const isError =
        health.className.includes("text-destructive") ||
        msg.includes("نیست") ||
        msg.includes("برقرار نشد") ||
        msg.includes("خطا") ||
        msg.includes("اتصال به سرور");
      const isChecking =
        !isOk &&
        !isError &&
        (health.disabled ||
          msg.includes("بررسی") ||
          health.className.includes("text-muted"));

      const tip = isChecking ? "در حال بررسی سرویس…" : msg;
      const color = isOk ? "ok" : isError ? "err" : "wait";
      const key = `${color}|${tip}`;

      // Position under chevron every time (layout may shift)
      const details = health.closest("details") as HTMLElement | null;
      const summary = details?.querySelector("summary") as HTMLElement | null;
      if (details && getComputedStyle(details).position === "static") {
        details.style.position = "relative";
      }

      let left = 16;
      let top = 52;
      if (summary) {
        const chevron =
          (summary.querySelector("svg") as SVGElement | null) ||
          (summary.lastElementChild as HTMLElement | null);
        const dRect = details!.getBoundingClientRect();
        const sRect = summary.getBoundingClientRect();
        top = Math.round(sRect.bottom - dRect.top + 8);
        if (chevron) {
          const cRect = chevron.getBoundingClientRect();
          // Center the 20px hit-area under the chevron
          left = Math.round(cRect.left - dRect.left + cRect.width / 2 - 10);
        } else {
          left = 14;
        }
      }

      health.style.position = "absolute";
      health.style.left = `${Math.max(8, left)}px`;
      health.style.top = `${top}px`;
      health.style.zIndex = "30";
      health.style.width = "1.25rem";
      health.style.height = "1.25rem";
      health.style.padding = "0";
      health.style.margin = "0";
      health.style.border = "none";
      health.style.borderRadius = "9999px";
      health.style.background = "transparent";
      health.style.display = "inline-flex";
      health.style.alignItems = "center";
      health.style.justifyContent = "center";
      health.style.cursor = "pointer";
      health.style.maxWidth = "none";
      health.style.pointerEvents = "auto";

      // Tooltip + a11y — always the real message
      health.setAttribute("title", tip);
      health.setAttribute("aria-label", tip);

      if (key === lastKey && health.dataset.vpStyled === "1") {
        // Still refresh tip in case React reset title
        return;
      }
      lastKey = key;

      let dot = health.querySelector(
        "[data-vp-dot-inner]",
      ) as HTMLElement | null;
      if (!dot) {
        health.querySelectorAll("span").forEach((s) => s.remove());
        Array.from(health.childNodes).forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) n.textContent = "";
        });
        dot = document.createElement("span");
        dot.dataset.vpDotInner = "1";
        dot.style.width = "0.75rem";
        dot.style.height = "0.75rem";
        dot.style.borderRadius = "9999px";
        dot.style.display = "block";
        dot.style.flexShrink = "0";
        dot.style.boxShadow = "0 0 0 2px var(--background, #0f172a)";
        health.appendChild(dot);
      }

      if (isOk) {
        dot.style.background = "#10b981";
        dot.style.animation = "none";
      } else if (isError) {
        dot.style.background = "#ef4444";
        dot.style.animation = "none";
      } else {
        dot.style.background = "#94a3b8";
        dot.style.animation = "pulse 1.5s ease-in-out infinite";
      }

      health.dataset.vpStyled = "1";
      // Ensure click still reaches React's onClick (re-check)
      health.style.pointerEvents = "auto";
    };

    apply();
    const timers = [200, 600, 1500, 3000].map((ms) =>
      window.setTimeout(apply, ms),
    );
    // Poll lightly for status changes after health check completes
    const poll = window.setInterval(apply, 2000);

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      window.clearInterval(poll);
    };
  }, []);

  return null;
}
