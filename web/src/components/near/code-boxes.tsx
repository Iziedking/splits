"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A 6-digit sign-in code as six boxes, one number each. Typing moves on, Backspace moves back, and
 * pasting (or a phone filling the code from the email) spreads the digits across the boxes.
 */
export function CodeBoxes({ value, onChange, onComplete, length = 6, label = "Code" }: { value: string; onChange: (code: string) => void; onComplete?: (code: string) => void; length?: number; label?: string }) {
  const boxes = React.useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  React.useEffect(() => focus(0), []); // eslint-disable-line react-hooks/exhaustive-deps

  function put(at: number, typed: string) {
    const digits = typed.replace(/\D/g, "");
    if (!digits) return;
    const next = (value.slice(0, at) + digits).slice(0, length);
    onChange(next);
    focus(next.length);
    if (next.length === length) onComplete?.(next);
  }

  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          aria-label={`Digit ${i + 1} of ${length}`}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          value={value[i] ?? ""}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value;
            // Replacing one box keeps what came before it; several digits at once fill on from here.
            if (v.replace(/\D/g, "").length > 1) return put(Math.min(i, value.length), v);
            if (!v) return onChange(value.slice(0, i));
            put(Math.min(i, value.length), v.slice(-1));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) {
              e.preventDefault();
              onChange(value.slice(0, i - 1));
              focus(i - 1);
            } else if (e.key === "ArrowLeft") focus(i - 1);
            else if (e.key === "ArrowRight") focus(i + 1);
          }}
          onPaste={(e) => {
            e.preventDefault();
            put(Math.min(i, value.length), e.clipboardData.getData("text"));
          }}
          className={cn(
            "h-14 w-full min-w-0 rounded-xl border border-foreground/12 bg-white text-center font-mono text-2xl font-semibold text-foreground tabular-nums",
            "transition-[border-color,box-shadow] duration-150 focus:border-primary focus:ring-4 focus:ring-primary/15 focus:outline-none",
            value[i] && "border-primary/50",
          )}
        />
      ))}
    </div>
  );
}
