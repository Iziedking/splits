"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import type { ActivityView } from "@/lib/api";
import { isFinal, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row =
  | { kind: "sent"; at: string; item: ActivityView["sent"][number] }
  | { kind: "received"; at: string; item: ActivityView["received"][number] };

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Money in and out, newest first, one card per transfer (UI_BRIEF.md v4). Received items come from
 * the wallet provider; if that list is unavailable, sent items still show and the gap is said.
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
      <div aria-busy="true" aria-label="Loading activity" className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="surface h-[72px] motion-safe:animate-pulse" />
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
        <div className="space-y-2">
          <Notice tone="error">{activity.receivedError}</Notice>
          <Button variant="secondary" className="w-full" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-muted-foreground">Money you send and receive shows here, each with its receipt.</p>
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 12).map((row) => {
            if (row.kind === "sent") {
              const t = row.item;
              const failed = t.status === "failed";
              const who =
                t.kind === "auto"
                  ? "Automatic split"
                  : t.splitId
                    ? `${splitNames[t.splitId] ?? "Split"} · split ${t.recipients} ways`
                    : t.recipients === 1
                      ? `To ${t.legs[0]?.name ?? "one person"}`
                      : `To ${t.recipients} people`;
              return (
                <li key={`s-${t.id}`}>
                  <Link
                    href={`/payments/${t.id}`}
                    className="surface flex items-center gap-3 p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate font-bold tabular-nums", failed && "text-muted-foreground line-through")}>
                        {t.quote && t.quote.currency !== "USD" ? `${SYMBOL[t.quote.currency] ?? ""}${t.quote.fiat} → $${t.amount}` : `$${t.amount}`}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                        {day(row.at)} · {who}
                        {(failed || !isFinal(t.status)) && (
                          <span className={cn("font-semibold", failed ? "text-destructive" : "text-primary")}>
                            {" · "}
                            {STATUS_LABEL[t.status]?.toLowerCase()}
                          </span>
                        )}
                      </span>
                    </span>
                    {!isFinal(t.status) && (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" aria-label="In progress" />
                    )}
                  </Link>
                </li>
              );
            }
            const r = row.item;
            return (
              <li key={`r-${r.txHash}`} className="surface p-4">
                <span className="block font-bold text-primary tabular-nums">+${r.amount}</span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                  {r.source === "topup" ? "Demo card top-up" : `From ${r.fromLabel ?? short(r.from)}`}
                  {r.purpose && <> · for {r.purpose}</>} · {day(row.at)}
                  {r.explorerUrl && (
                    <>
                      {" · "}
                      <a href={r.explorerUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        receipt
                      </a>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
