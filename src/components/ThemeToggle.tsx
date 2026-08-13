import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefers;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "حالت روشن" : "حالت تاریک"}
      title={dark ? "حالت روشن" : "حالت تاریک"}
      className={
        compact
          ? "inline-flex size-6.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          : "inline-flex size-10 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-primary hover:text-primary-foreground"
      }
    >
      {dark ? <Sun className={compact ? "size-3.5" : "size-5"} /> : <Moon className={compact ? "size-3.5" : "size-5"} />}
    </button>
  );
}
