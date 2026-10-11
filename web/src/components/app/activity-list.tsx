"use client";

import { ArrowDownLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import type { ActivityView } from "@/lib/api";
import { isFinal, STATUS_LABEL } from "@/lib/format";
import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

type Row =
  | { kind: "sent"; at: string; item: ActivityView["sent"][number] }
  | { kind: "received"; at: string; item: ActivityView["received"][number] };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Money in and out, newest first. Received items come from the wallet provider; if that list is
 * unavailable, sent items still show and the gap is said out loud rather than hidden.
 */
export function ActivityList({
  activity,
  splitNames,
  onRetry,
}: {
  activity: ActivityView | null;
  splitNames: Record<string, string>;
  onRetry: () => void;
}) {
  if (!activity) {
    return (
      <div aria-busy="true" aria-label="Loading activity" className="surface space-y-px overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 bg-muted/60 motion-safe:animate-pulse" />
        ))}
      </div>
    );
  }

  const rows: Row[] = [
    ...activity.sent.map((item) => ({ kind: "sent" as const, at: item.createdAt, item })),
    ...activity.received.map((item) => ({ kind: "received" as const, at: item.at, item })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-3">
      {activity.receivedError && (
        <div className="flex flex-wrap items-center gap-3">
          <Notice tone="error" className="flex-1">
            {activity.receivedError}
          </Notice>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-muted-foreground">Money you send and receive shows here, each with its receipt.</p>
      ) : (
        <ul className="surface divide-y divide-border overflow-hidden">
          {rows.slice(0, 12).map((row) =>
            row.kind === "sent" ? (
              <li key={`s-${row.item.id}`}>
                <Link
                  href={`/payments/${row.item.id}`}
                  className="flex min-h-16 items-center gap-4 px-5 py-3 transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none"
                >
                  <span aria-hidden="true" className="flex w-8 shrink-0 -space-x-1.5">
                    {row.item.legs.slice(0, 3).map((_, i) => (
                      <span key={i} className="h-4 w-4 rounded-full border-2 border-card" style={{ backgroundColor: purposeFill(i) }} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {row.item.kind === "auto"
                        ? "Automatic split"
                        : row.item.splitId
                          ? (splitNames[row.item.splitId] ?? "Payment")
                          : row.item.recipients === 1
                            ? `To ${row.item.legs[0]?.name ?? "one person"}`
                            : `To ${row.item.recipients} people`}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {day(row.at)},{" "}
                      <span
                        className={cn(row.item.status === "failed" && "text-destructive", row.item.status === "settled" && "text-success")}
                      >
                        {STATUS_LABEL[row.item.status]?.toLowerCase()}
                      </span>
                    </span>
                  </span>
                  <span className="figure text-lg">−${row.item.amount}</span>
                  {!isFinal(row.item.status) && (
                    <span className="h-2.5 w-2.5 rounded-full bg-purpose-1 motion-safe:animate-pulse" aria-label="In progress" />
                  )}
                </Link>
              </li>
            ) : (
              <li key={`r-${row.item.txHash}`} className="flex min-h-16 items-center gap-4 px-5 py-3">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/12 text-success">
                  <ArrowDownLeft className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {row.item.source === "topup" ? "Demo card top-up" : `From ${row.item.fromLabel ?? short(row.item.from)}`}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {day(row.at)}
                    {row.item.purpose && <>, for {row.item.purpose}</>}
                    {row.item.explorerUrl && (
                      <>
                        {", "}
                        <a href={row.item.explorerUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          receipt
                        </a>
                      </>
                    )}
                  </span>
                </span>
                <span className="figure text-lg text-success">+${row.item.amount}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
