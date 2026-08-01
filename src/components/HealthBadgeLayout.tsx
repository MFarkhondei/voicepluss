import { useEffect } from "react";

/**
 * Turns the Groq health badge into a small status dot at the top-left of the
 * record panel. Green = connected, red = disconnected. Hover shows the message.
 */
export function HealthBadgeLayout() {
  useEffect(() => {
    const apply = () => {
      const btn = document.querySelector(
        'button[title*="تست سرویس Groq"], button[title*="سرویس Groq"], button[aria-label*="سرویس"]',
      ) as HTMLButtonElement | null;

      // Fallback: find the pill that contains the status text
      let health =
        btn ||
        (Array.from(document.querySelectorAll("button")).find((b) => {
          const t = b.textContent || "";
          return (
            t.includes("سرویس") &&
            (t.includes("فعال") || t.includes("بررسی") || t.includes("دسترس") || t.includes("اتصال"))
          );
        }) as HTMLButtonElement | undefined);

      if (!health) return;

      // Find the record panel content (parent of mic area)
      const panelBody =
        health.closest(".border-t") ||
        health.closest("[class*='px-']") ||
        health.parentElement;
      if (!panelBody) return;

      const host = panelBody as HTMLElement;
      if (getComputedStyle(host).position === "static") {
        host.style.position = "relative";
      }

      // Detect state from classes / text
      const text = (health.textContent || "").trim();
      const title = health.getAttribute("title") || text;
      const isOk =
        health.className.includes("text-primary") ||
        text.includes("فعال") ||
        title.includes("فعال");
      const isError =
        health.className.includes("text-destructive") ||
        text.includes("نیست") ||
        text.includes("برقرار نشد") ||
        text.includes("خطا") ||
        title.includes("نیست");
      const isChecking = text.includes("بررسی") || health.disabled;

      // Tooltip: keep full message
      const tip =
        title && title !== "تست سرویس Groq"
          ? title
          : text || (isOk ? "سرویس Groq فعال است" : "سرویس در دسترس نیست");
      health.setAttribute("title", tip);
      health.setAttribute("aria-label", tip);

      // Restyle as a pure dot in the top-left (same spot user marked)
      health.style.position = "absolute";
      health.style.left = "0.25rem";
      health.style.top = "0.25rem";
      health.style.zIndex = "10";
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

      // Hide text nodes / extra spans; keep only one colored circle
      const spans = Array.from(health.querySelectorAll("span"));
      spans.forEach((s, i) => {
        if (i === 0) {
          const dot = s as HTMLElement;
          dot.style.width = "0.75rem";
          dot.style.height = "0.75rem";
          dot.style.borderRadius = "9999px";
          dot.style.display = "block";
          dot.style.flexShrink = "0";
          dot.style.boxShadow = "0 0 0 2px var(--background, #0f172a)";
          if (isOk) {
            dot.style.background = "#10b981"; // emerald-500
            dot.style.animation = "none";
          } else if (isError) {
            dot.style.background = "#ef4444"; // red-500
            dot.style.animation = "none";
          } else {
            dot.style.background = "#94a3b8";
            dot.style.animation = "pulse 1.5s ease-in-out infinite";
          }
          dot.textContent = "";
        } else {
          (s as HTMLElement).style.display = "none";
        }
      });

      // If no inner span, inject one
      if (spans.length === 0) {
        health.textContent = "";
        const dot = document.createElement("span");
        dot.style.width = "0.75rem";
        dot.style.height = "0.75rem";
        dot.style.borderRadius = "9999px";
        dot.style.display = "block";
        dot.style.background = isOk ? "#10b981" : isError ? "#ef4444" : "#94a3b8";
        health.appendChild(dot);
      }
    };

    apply();
    const id = window.setInterval(apply, 500);
    const obs = new MutationObserver(apply);
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "title", "disabled"],
    });

    return () => {
      window.clearInterval(id);
      obs.disconnect();
    };
  }, []);

  return null;
}
