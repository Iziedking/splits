"use client";

import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

/**
 * Where the arrow keys move in a group of options: the next or previous enabled one, wrapping, or the
 * first and last with Home and End. Null for any other key.
 */
export function nextIndex(key: string, from: number, disabled: boolean[]): number | null {
  const n = disabled.length;
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  const start = key === "Home" ? -1 : key === "End" ? n : step ? from : null;
  if (start === null) return null;
  const dir = key === "End" ? -1 : key === "Home" ? 1 : step;
  for (let i = 1; i <= n; i++) {
    const at = (((start + dir * i) % n) + n) % n;
    if (!disabled[at]) return at;
  }
  return null;
}

/** The props for the panel a tab controls. */
export function tabPanelProps(idBase: string, value: string) {
  return { id: `${idBase}-panel-${value}`, role: "tabpanel", "aria-labelledby": `${idBase}-tab-${value}`, tabIndex: 0 } as const;
}

export interface SegmentedProps<T extends string> {
  /** "tabs" when each option shows its own panel, "radio" when it sets a value. */
  kind: "tabs" | "radio";
  label?: string;
  labelledBy?: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** For tabs: the prefix `tabPanelProps` uses, so each tab names its panel. */
  idBase?: string;
  /** The selected fill slides between options; under reduced motion it moves at once. */
  animated?: boolean;
  className?: string;
}

/**
 * The one segmented control: 44px options in a glass track, the selected one filled teal. One tab
 * stop; the arrow keys move between options and choose as they go (WAI-ARIA tabs and radio group).
 */
export function Segmented<T extends string>({ kind, label, labelledBy, options, value, onChange, idBase, animated = false, className }: SegmentedProps<T>) {
  const reduce = useReducedMotion();
  const layoutId = React.useId();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = options.map((o) => Boolean(o.disabled));
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 && !disabled[selected] ? selected : disabled.indexOf(false);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const to = nextIndex(e.key, index, disabled);
    if (to === null) return;
    e.preventDefault();
    onChange(options[to]!.value);
    refs.current[to]?.focus();
  }

  return (
    <div
      role={kind === "tabs" ? "tablist" : "radiogroup"}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cn("grid auto-cols-fr grid-flow-col rounded-full bg-white/60 p-1 ring-1 ring-white", className)}
    >
      {options.map((option, i) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={kind === "tabs" ? "tab" : "radio"}
            id={kind === "tabs" && idBase ? `${idBase}-tab-${option.value}` : undefined}
            aria-controls={kind === "tabs" && idBase ? `${idBase}-panel-${option.value}` : undefined}
            aria-selected={kind === "tabs" ? on : undefined}
            aria-checked={kind === "radio" ? on : undefined}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative z-10 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
              on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              on && !animated && "bg-primary-fill",
            )}
          >
            {on && animated && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-full bg-primary-fill"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
