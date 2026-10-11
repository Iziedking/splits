"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { SplitView } from "@/lib/api";
import { initials } from "@/lib/format";
import { purposeFill, textOnPurpose } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";
import { Ribbon } from "./ribbon";

/**
 * A split on the home screen, after the reference card: the month's total as the figure, then a
 * panel that opens the send flow. The panel shows the split as colour blocks and the people it
 * reaches as chips in their purpose colour.
 */
export function SplitCard({ split, sentThisMonth, onOpen }: { split: SplitView; sentThisMonth: string; onOpen?: () => void }) {
  const reduce = useReducedMotion();
  const ready = split.status === "active";
  const purposes = [...new Set(split.legs.map((l) => l.purpose))];
  const subtitle =
    split.status === "pending" ? "Setting up on Arc" : split.status === "failed" ? "Couldn't be set up" : purposes.join(", ");
  const people = split.legs.length;

  return (
    <article className="surface flex flex-col p-6">
      <p className="text-[15px] font-medium text-muted-foreground">Sent this month</p>
      <p className="figure mt-1 text-5xl">
        <CountUp value={sentThisMonth} />
      </p>

      <motion.button
        type="button"
        onClick={ready ? onOpen : undefined}
        disabled={!ready}
        aria-label={`${split.name}, ${subtitle}, ${people} ${people === 1 ? "person" : "people"}${ready ? ". Send money" : ""}`}
        whileHover={ready && !reduce ? { y: -2 } : undefined}
        whileTap={ready && !reduce ? { scale: 0.985 } : undefined}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className={cn(
          "group mt-6 block w-full rounded-2xl bg-secondary/70 p-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          ready ? "cursor-pointer hover:bg-secondary" : "cursor-default",
        )}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-semibold">{split.name}</span>
            <span className={cn("block truncate text-sm", split.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
              {split.status === "pending" && (
                <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-purpose-1 motion-safe:animate-pulse" />
              )}
              {subtitle.charAt(0).toUpperCase() + subtitle.slice(1)}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 group-hover:rotate-45 motion-reduce:transition-none"
          >
            <ArrowUpRight className="h-5 w-5" />
          </span>
        </span>

        <Ribbon className="mt-4" parts={split.legs.map((l) => ({ label: l.name, weight: l.percent ?? Number(l.fixed ?? 0) }))} />

        <span className="mt-4 flex items-center" aria-hidden="true">
          {split.legs.slice(0, 4).map((leg, i) => (
            <span
              key={i}
              title={`${leg.name}: ${leg.purpose}`}
              className="flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-secondary text-xs font-bold"
              style={{ marginLeft: i === 0 ? 0 : -10, backgroundColor: purposeFill(i), color: textOnPurpose(i) }}
            >
              {initials(leg.name)}
            </span>
          ))}
          {people > 4 && (
            <span className="-ml-2.5 flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-secondary bg-primary text-xs font-bold text-primary-foreground">
              +{people - 4}
            </span>
          )}
        </span>
      </motion.button>
    </article>
  );
}
