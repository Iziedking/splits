"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * An on/off switch: the whole row is the control, the label on the left and the track on the right.
 * `className` styles the row.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: React.ReactNode;
  /** A quieter line under the label. */
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
        className,
      )}
    >
      <span>
        {label}
        {description && <span className="block text-xs font-normal text-muted-foreground">{description}</span>}
      </span>
      <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors motion-reduce:transition-none", checked ? "bg-primary" : "bg-muted")} aria-hidden="true">
        <span
          className={cn(
            "absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow-thumb transition-transform motion-reduce:transition-none",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
