"use client";

import { motion, useReducedMotion } from "motion/react";
import { PurposeDot } from "@/components/app/purpose-dot";
import type { CheckLine, PayoutCheck } from "@/lib/api";
import { cn } from "@/lib/utils";

const short = (r: string) => (r.startsWith("0x") ? `${r.slice(0, 6)}…${r.slice(-4)}` : r);

function Status({ line }: { line: CheckLine }) {
  const ok = line.status === "ready";
  return (
    <span className={cn("inline-flex items-start gap-2 text-sm", ok ? "text-success-text" : "text-destructive")}>
      <span aria-hidden="true" className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-destructive")} />
      {ok ? "Ready" : line.message}
    </span>
  );
}

/**
 * Every pasted line with what it will pay and whether it can, as a list of two-line items (the app
 * is a phone-width column). Rows settle in once per check, not on every keystroke. The one live
 * sentence is the summary, so a new check is heard as "20 people checked, 19 ready", not row by row.
 */
export function ReviewTable({ check }: { check: PayoutCheck }) {
  const reduce = useReducedMotion();
  const ready = check.lines.filter((l) => l.status === "ready").length;
  const stagger = Math.min(0.015, 0.3 / Math.max(1, check.lines.length));
  const summary = `${check.lines.length === 1 ? "1 person" : `${check.lines.length} people`} checked, ${ready} ready${check.total ? `, $${check.total} in total` : ""}.`;

  return (
    <section aria-label="Checked list" className="surface overflow-hidden">
      <p role="status" className="sr-only">
        {summary}
      </p>
      <ul className="divide-y divide-border">
        {check.lines.map((line, i) => (
          <motion.li
            key={`${line.line}-${line.raw}`}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : i * stagger, duration: 0.2 }}
            className={cn("grid grid-cols-[auto_1fr_auto] gap-x-3 px-4 py-3", line.status !== "ready" && "bg-destructive/5")}
          >
            <span className="text-sm text-muted-foreground tabular-nums">
              <span className="sr-only">Line </span>
              {line.line}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <PurposeDot index={i} />
              <span className="truncate font-medium" title={line.recipient ?? line.raw}>
                {/* A tag pays a Splits account: said outright, so a pasted social handle isn't mistaken for one. */}
                {line.recipient?.startsWith("@") ? `Splits account ${line.recipient}` : line.recipient ? short(line.recipient) : line.raw}
              </span>
            </span>
            <span className={cn("text-right font-semibold tabular-nums", line.status !== "ready" && "text-muted-foreground line-through")}>
              {line.amount ? `$${line.amount}` : "–"}
            </span>
            <span className="col-span-3 col-start-2 text-sm text-muted-foreground">{line.label}</span>
            <span className="col-span-3 col-start-2">
              <Status line={line} />
            </span>
          </motion.li>
        ))}
      </ul>
      <div aria-hidden="true" className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border bg-secondary/40 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {ready} of {check.lines.length} ready
        </span>
        <span className="figure text-xl">{check.total ? `$${check.total}` : "–"}</span>
      </div>
    </section>
  );
}
