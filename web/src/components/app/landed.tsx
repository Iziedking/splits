"use client";

import { ExternalLink, ReceiptText, Share2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { CountUp } from "@/components/app/count-up";
import { ManualLink, receiptText, rememberReturn, shareLink, ShareReceipts } from "@/components/app/receipt-share";
import type { TransferView } from "@/lib/api";
import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * S8: one card per person with what they got and what it was for. On a phone, one column. From
 * `lg` (UI_BRIEF.md v5) the summary, links and actions stay in view on the left and the people
 * paid fill the right, two cards to a row; `contents` wrappers keep the phone order.
 */
export function Landed({
  t,
  preview,
  returnTo,
  actions,
  aside,
}: {
  t: TransferView;
  preview: boolean;
  /** Where "Back to payment" on a receipt leads: /payments/<id> or /p/<token>. */
  returnTo: string;
  actions: React.ReactNode;
  /** More for the summary column, after the actions (the visitor's "Email me my receipt"). */
  aside?: React.ReactNode;
}) {
  const compact = t.legs.length > 6;
  const [picking, setPicking] = React.useState(false);
  const [shared, setShared] = React.useState<"copied" | "failed" | null>(null);
  const hasReceipts = t.legs.some((l) => l.receipt);

  /** One recipient: share theirs straight away. More: choose whose to share. */
  async function share() {
    const only = t.legs.length === 1 ? t.legs[0] : undefined;
    if (!only?.receipt) return setPicking(true);
    const result = await shareLink(only.receipt, receiptText(only));
    if (result === "copied" || result === "failed") setShared(result);
  }

  return (
    <div className="enter flex flex-col gap-6 pt-6 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:gap-12">
      <div className="contents lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-6">
        <div className="order-1 lg:order-none">
          <h1 className="text-[2rem] leading-tight font-extrabold">{t.recipients === 1 ? "Landed." : "Landed, divided."}</h1>
          <p className="mt-1 text-muted-foreground">
            <CountUp value={t.amount} /> reached {t.recipients === 1 ? (t.legs[0]?.name ?? "their wallet") : `${t.recipients} wallets`}.
          </p>
          {t.fee !== "0.00" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Plus a ${t.fee} Splits fee ({t.feePercent}%).
            </p>
          )}
        </div>

        <p className="order-3 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-primary lg:order-none">
          {t.explorerUrl && (
            <a href={t.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline">
              View on Arc explorer
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          {t.explorerUrl && hasReceipts && <span aria-hidden="true">·</span>}
          {hasReceipts && (
            <button type="button" onClick={() => void share()} className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline">
              {shared === "copied" ? "Receipt link copied" : t.legs.length === 1 ? "Share receipt" : "Share a receipt"}
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </p>
        {shared === "failed" && t.legs[0]?.receipt && (
          <div role="status" className="order-3 -mt-3 text-sm lg:order-none">
            <span className="font-semibold">Copy this link to share it:</span>
            <ManualLink path={t.legs[0].receipt} />
          </div>
        )}
        {!t.explorerUrl && preview && (
          <p className="order-3 text-sm text-muted-foreground lg:order-none">Preview mode: these receipts are simulated, so there is no explorer link.</p>
        )}
        <ShareReceipts legs={t.legs} returnTo={returnTo} open={picking} onClose={() => setPicking(false)} />

        <div className="order-4 space-y-3 lg:order-none">{actions}</div>
        {aside && <div className="order-5 lg:order-none">{aside}</div>}
      </div>

      <ul className={cn("order-2 lg:order-none", compact ? "surface divide-y divide-white/80 p-1" : "space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0")}>
        {t.legs.map((leg, i) => (
          <li key={i} className={cn(compact ? "flex items-center justify-between gap-3 px-4 py-3" : "surface p-4")}>
            {compact ? (
              <>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                  <span className="truncate font-medium">{leg.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-bold tabular-nums">${leg.amount}</span>
                  {leg.receipt && (
                    <Link
                      href={leg.receipt}
                      onClick={() => rememberReturn(returnTo, leg.receipt!)}
                      aria-label={`View ${leg.name}'s receipt`}
                      className="-my-2 -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-primary hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <ReceiptText className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="block truncate text-sm text-muted-foreground">
                  {leg.name} · {leg.purpose}
                </span>
                <span className="figure mt-1 block text-[1.75rem] leading-none">${leg.amount}</span>
                <span className="mt-3 flex items-center justify-between gap-3">
                  <span aria-hidden="true" className="block h-1.5 w-14 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                  {leg.receipt && (
                    <Link
                      href={leg.receipt}
                      onClick={() => rememberReturn(returnTo, leg.receipt!)}
                      className="-my-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <ReceiptText className="h-4 w-4" aria-hidden="true" />
                      View receipt
                      <span className="sr-only"> for {leg.name}</span>
                    </Link>
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
