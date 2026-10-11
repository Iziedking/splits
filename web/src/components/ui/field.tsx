import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "block min-h-12 w-full rounded-[14px] border border-input bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-invalid:border-destructive";

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

export function Notice({ tone = "info", children, className }: { tone?: "info" | "error" | "success"; children: React.ReactNode; className?: string }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[14px] px-4 py-3 text-sm",
        tone === "error" && "bg-destructive/10 text-destructive",
        tone === "info" && "bg-accent/60 text-accent-foreground",
        tone === "success" && "bg-success/10 text-success",
        className,
      )}
    >
      {children}
    </p>
  );
}
