import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "block min-h-12 w-full rounded-sm border border-input bg-white/80 px-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-invalid:border-destructive";

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

/** A labelled input. The hint and error are tied to it for screen readers. */
export const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  ({ label, hint, error, id, className, ...props }, ref) => {
    const generated = React.useId();
    const inputId = id ?? generated;
    const describedBy = [hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null].filter(Boolean).join(" ");
    return (
      <div className={className}>
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={inputClass}
          {...props}
        />
        {hint && !error && (
          <p id={`${inputId}-hint`} className="mt-1 text-sm text-muted-foreground">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${inputId}-error`} className="mt-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Field.displayName = "Field";

/**
 * A short message in a tinted box. Errors are alerts and successes are statuses, so screen readers
 * hear them when they appear; plain information is read in place. `live` overrides either way.
 */
export function Notice({
  tone = "info",
  live,
  children,
  className,
}: {
  tone?: "info" | "error" | "success";
  /** Announce it: by default errors (as alerts) and successes do and information does not. */
  live?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={!(live ?? tone !== "info") ? undefined : tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-sm px-4 py-3 text-sm",
        tone === "error" && "bg-destructive/10 text-destructive",
        tone === "info" && "bg-white/70 text-muted-foreground ring-1 ring-white",
        tone === "success" && "bg-success/10 text-success-text",
        className,
      )}
    >
      {children}
    </div>
  );
}
