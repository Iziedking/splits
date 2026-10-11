"use client";

import { motion, useReducedMotion } from "motion/react";
import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

export type RibbonPart = { label: string; weight: number };

/**
 * The split as separate rounded bars, one per part (UI_BRIEF.md v4), each part as wide as its share. When shares change
 * (typing in the builder, a new amount) the blocks spring to their new widths.
 */
export function Ribbon({ parts, className, height = 12 }: { parts: RibbonPart[]; className?: string; height?: number }) {
  const reduce = useReducedMotion();
  const total = parts.reduce((s, p) => s + Math.max(0, p.weight), 0);
  const description = parts
    .map((p) => `${p.label} ${total > 0 ? Math.round((Math.max(0, p.weight) / total) * 100) : 0}%`)
    .join(", ");

  return (
    <div
      role="img"
      aria-label={total > 0 ? `Split: ${description}` : "Split not set yet"}
      className={cn("flex w-full gap-1.5", total === 0 && "rounded-full bg-white/60", className)}
      style={{ height }}
    >
      {parts.map((part, i) => {
        const pct = total > 0 ? (Math.max(0, part.weight) / total) * 100 : 0;
        if (pct === 0) return null;
        return (
          <motion.span
            key={i}
            className="block h-full min-w-[6px] rounded-full"
            style={{ backgroundColor: purposeFill(i), flexBasis: 0 }}
            initial={false}
            animate={{ flexGrow: pct }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
          />
        );
      })}
    </div>
  );
}
