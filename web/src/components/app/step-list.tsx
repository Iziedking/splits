import { Check, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "active" | "waiting" | "failed";

export interface Step {
  key: string;
  label: React.ReactNode;
  state: StepState;
}

const spoken: Record<StepState, string> = {
  done: "done",
  active: "in progress",
  waiting: "not started",
  failed: "failed",
};

/**
 * A payment's progress as a list. Each state has its own shape (a check, a cross, a pulsing ring, a
 * plain ring) as well as its own colour, and screen readers hear the state after the label.
 * `tone` is "night" on the dark sending screen.
 */
export function StepList({ steps, tone = "day", className }: { steps: Step[]; tone?: "day" | "night"; className?: string }) {
  const night = tone === "night";
  return (
    <ol aria-label="Progress" className={cn("space-y-4", className)}>
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300 motion-reduce:transition-none",
              step.state === "done" && "bg-primary text-white",
              step.state === "failed" && "bg-destructive text-white",
              step.state === "active" && cn("border-2 motion-safe:animate-pulse", night ? "border-white" : "border-primary"),
              step.state === "waiting" && cn("border-2", night ? "border-white/35" : "border-muted-foreground/40"),
            )}
          >
            {step.state === "done" && <Check className="h-3 w-3" strokeWidth={3.5} />}
            {step.state === "failed" && <X className="h-3 w-3" strokeWidth={3.5} />}
          </span>
          <span className={cn("font-medium", step.state === "waiting" && (night ? "text-white/60" : "text-muted-foreground"))}>
            {step.label}
            <span className="sr-only">: {spoken[step.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
