import { useEffect } from "react";

/**
 * Groq status as a green/red dot under the panel collapse chevron.
 * Safe: no MutationObserver loops (was freezing the app).
 */
export function HealthBadgeLayout() {
  useEffect(() => {
    let cancelled = false;
    let lastState = "";
    let tries = 0;

    const findHealth = (): HTMLButtonElement | null => {
      const byTitle = document.querySelector(
        'button[title*="تست سرویس Groq"], button[title*="سرویس Groq"]',
      ) as HTMLButtonElement | null;
      if (byTitle) return byTitle;

      return (
        (Array.from(document.querySelectorAll("button")).find((b) => {
          if (b.dataset.vpDot === "1") return true;
          const t = b.textContent || "";
          return (
            t.includes("سرویس") &&
            (t.includes("فعال") ||
              t.includes("بررسی") ||
              t.includes("دسترس") ||
              t.includes("اتصال"))
          );
        }) as HTMLButtonElement | undefined) || null
      );
    };

    const apply = () => {
      if (cancelled) return;
      const health = findHealth();
      if (!health) {
        if (tries++ < 20) window.setTimeout(apply, 300);
        return;
      }

      health.dataset.vpDot = "1";

      const text = (health.textContent || "").replace(/\s+/g, " ").trim();
      const titleAttr = health.getAttribute("title") || "";
      const isOk =
        health.className.includes("text-primary") ||
        text.includes("فعال") ||
        titleAttr.includes("فعال");
      const isError =
        health.className.includes("text-destructive") ||
        text.includes("نیست") ||
        text.includes("برقرار نشد") ||
        text.includes("خطا") ||
        titleAttr.includes("نیست") ||
        titleAttr.includes("برقرار نشد");

      const tip =
        titleAttr && titleAttr !== "تست سرویس Groq"
          ? titleAttr
          : text || (isOk ? "سرویس Groq فعال است" : "سرویس در دسترس نیست");

      const stateKey = `${isOk ? "ok" : isError ? "err" : "wait"}|${tip}`;
      // Only restyle when state changes — prevents freeze from constant DOM writes
      if (stateKey === lastState && health.dataset.vpStyled === "1") return;
      lastState = stateKey;

      health.setAttribute("title", tip);
      health.setAttribute("aria-label", tip);

      // Anchor under the collapse chevron (left side of summary in RTL)
      const details = health.closest("details") as HTMLElement | null;
      const summary = details?.querySelector("summary") as HTMLElement | null;
      const host = (details || health.parentElement) as HTMLElement | null;
      if (host && getComputedStyle(host).position === "static") {
        host.style.position = "relative";
      }

      // Summary height ≈ chevron row; sit just below it, slightly inset from left
      const summaryH = summary ? Math.round(summary.getBoundingClientRect().height) : 48;
      health.style.position = "absolute";
      health.style.left = "1.1rem"; // کمی به راست نسبت به لبه
      health.style.top = `${summaryH + 6}px`;
      health.style.zIndex = "20";
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
      health.style.boxShadow = "none";

      let dot = health.querySelector("[data-vp-dot-inner]") as HTMLElement | null;
      if (!dot) {
        // Clear text label once
        health.querySelectorAll("span").forEach((s) => s.remove());
        health.childNodes.forEach((n) => {
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
    };

    // Initial attempts only — no aggressive MutationObserver on whole body
    apply();
    const t1 = window.setTimeout(apply, 400);
    const t2 = window.setTimeout(apply, 1200);
    const t3 = window.setTimeout(apply, 2500);

    // Light poll for health state changes (ok → error) without DOM thrashing
    const poll = window.setInterval(() => {
      if (cancelled) return;
      apply();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearInterval(poll);
    };
  }, []);

  return null;
}
