"use client";

import { motion, useReducedMotion } from "motion/react";
import type { CheckLine, PayoutCheck } from "@/lib/api";
import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

const short = (r: string) => (r.startsWith("0x") ? `${r.slice(0, 6)}…${r.slice(-4)}` : r);

function Status({ line }: { line: CheckLine }) {
  const ok = line.status === "ready";
  return (
    <span className={cn("inline-flex items-start gap-2 text-sm", ok ? "text-success" : "text-destructive")}>
      <span aria-hidden="true" className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", ok ? "bg-purpose-2" : "bg-purpose-3")} />
      {ok ? "Ready" : line.message}
    </span>
  );
}

/**
 * Every pasted line with what it will pay and whether it can. Rows settle in once per check, not
 * on every keystroke. Below 640px each row becomes a two-line item.
 */
export function ReviewTable({ check }: { check: PayoutCheck }) {
  const reduce = useReducedMotion();
  const ready = check.lines.filter((l) => l.status === "ready").length;
  const stagger = Math.min(0.015, 0.3 / Math.max(1, check.lines.length));

  return (
    <div className="surface overflow-hidden">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          {check.lines.length} people checked, {ready} ready
        </caption>
        <thead className="hidden bg-secondary/60 text-sm text-muted-foreground sm:table-header-group">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Line
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Who
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              For
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {check.lines.map((line, i) => (
            <motion.tr
              key={`${line.line}-${line.raw}`}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : i * stagger, duration: 0.2 }}
              className={cn(
                "grid grid-cols-[auto_1fr_auto] gap-x-3 px-4 py-3 sm:table-row sm:p-0",
                line.status !== "ready" && "bg-purpose-3/5",
              )}
            >
              <td className="text-sm text-muted-foreground tabular-nums sm:px-4 sm:py-3">{line.line}</td>
              <td className="min-w-0 sm:px-4 sm:py-3">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                  <span className="truncate font-medium" title={line.recipient ?? line.raw}>
                    {line.recipient ? short(line.recipient) : line.raw}
                  </span>
                </span>
              </td>
              <td
                className={cn(
                  "text-right font-semibold tabular-nums sm:px-4 sm:py-3",
                  line.status !== "ready" && "text-muted-foreground line-through",
                )}
              >
                {line.amount ? `$${line.amount}` : "–"}
              </td>
              <td className="col-span-3 col-start-2 text-sm text-muted-foreground sm:px-4 sm:py-3">{line.label}</td>
              <td className="col-span-3 col-start-2 sm:px-4 sm:py-3">
                <Status line={line} />
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border bg-secondary/40 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {ready} of {check.lines.length} ready
        </span>
        <span className="figure text-xl">{check.total ? `$${check.total}` : "–"}</span>
      </div>
    </div>
  );
}
