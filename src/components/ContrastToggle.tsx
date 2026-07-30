import { useEffect, useState } from "react";
import { Contrast } from "lucide-react";

/** حالت کنتراست بالا برای خوانایی بیشتر (دسترسی‌پذیری) */
export function ContrastToggle() {
  const [high, setHigh] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("contrast") === "high";
    setHigh(stored);
    document.documentElement.classList.toggle("hc", stored);
  }, []);

  const toggle = () => {
    const next = !high;
    setHigh(next);
    document.documentElement.classList.toggle("hc", next);
    localStorage.setItem("contrast", next ? "high" : "normal");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={high}
      aria-label={high ? "خاموش کردن کنتراست بالا" : "روشن کردن کنتراست بالا"}
      title={high ? "کنتراست عادی" : "کنتراست بالا"}
      className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-primary hover:text-primary-foreground"
    >
      <Contrast className="size-5" />
    </button>
  );
}
