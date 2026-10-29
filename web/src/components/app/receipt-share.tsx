"use client";

import { Check, ReceiptText, Share2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Sheet } from "@/components/app/sheet";
import type { TransferView } from "@/lib/api";
import { cn } from "@/lib/utils";

type Leg = TransferView["legs"][number];

/**
 * Shares a receipt link with the phone's share sheet, or copies it where there is none.
 * "cancelled" means the person closed the share sheet; nothing went wrong.
 */
export async function shareLink(path: string, text: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = new URL(path, window.location.origin).toString();
  try {
    if (navigator.share) {
      await navigator.share({ title: "Splits receipt", text, url });
      return "shared";
    }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch (err) {
    return err instanceof DOMException && err.name === "AbortError" ? "cancelled" : "failed";
  }
}

/** Where sharing and copying are both blocked: the link itself, selected, ready to copy by hand. */
export function ManualLink({ path }: { path: string }) {
  const url = typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
  return (
    <input
      readOnly
      value={url}
      aria-label="Receipt link"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      className="mt-2 min-h-11 w-full rounded-md border border-border bg-white px-3 text-base text-foreground lg:text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    />
  );
}

const RETURN_KEY = "splits:receipt-return";
const PAYMENT_PATH = /^\/(payments\/[0-9a-f-]{36}|p\/[A-Za-z0-9_-]{24})$/;

/** Remembers which payment this receipt was opened from, so that receipt can offer the way back. */
export function rememberReturn(from: string, receipt: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ from, receipt }));
  } catch {
    // Storage blocked: the receipt simply shows no back link.
  }
}

/** The payment this receipt was opened from in this tab, if any. A shared link opened cold has none. */
export function readReturn(receipt: string): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? "null") as { from?: unknown; receipt?: unknown } | null;
    return saved?.receipt === receipt && typeof saved.from === "string" && PAYMENT_PATH.test(saved.from) ? saved.from : null;
  } catch {
    return null;
  }
}

export const receiptText = (leg: Pick<Leg, "amount" | "purpose" | "name">) =>
  `Receipt for $${leg.amount} to ${leg.name}${leg.purpose ? `, for ${leg.purpose}` : ""}. Paid with Splits on Arc.`;

/**
 * Pick whose receipt to share. Each link opens that person's part only, so the list is the
 * decision: one row per recipient, each with its own share and view.
 */
export function ShareReceipts({
  legs,
  returnTo,
  open,
  onClose,
}: {
  legs: Leg[];
  returnTo: string;
  open: boolean;
  onClose: () => void;
}) {
  const [filter, setFilter] = React.useState("");
  const [done, setDone] = React.useState<{ index: number; result: "copied" | "shared" | "failed" } | null>(null);

  const rows = legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => {
      const q = filter.trim().toLowerCase();
      return !q || `${leg.name} ${leg.address} ${leg.purpose}`.toLowerCase().includes(q);
    });

  async function share(leg: Leg, index: number) {
    if (!leg.receipt) return;
    const result = await shareLink(leg.receipt, receiptText(leg));
    if (result !== "cancelled") setDone({ index, result });
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        setDone(null);
        setFilter("");
        onClose();
      }}
      title="Share a receipt"
      description={<>Each receipt shows one person&apos;s part, nobody else&apos;s.</>}
    >
      {legs.length > 8 && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a name or address"
          aria-label="Find a recipient"
          className="mt-4 min-h-11 w-full rounded-full border border-border bg-white px-4 text-base lg:text-ui focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      )}

      <ul className="-mx-2 mt-4 min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {rows.map(({ leg, index }) => (
          <li key={index} className="flex items-center gap-3 px-2 py-3">
            <PurposeDot index={index} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{leg.name}</span>
              <span className="block truncate text-sm text-muted-foreground tabular-nums">
                ${leg.amount}
                {leg.purpose && ` for ${leg.purpose}`}
              </span>
              {done?.index === index && (
                <span role="status" className={cn("block text-sm font-semibold", done.result === "failed" ? "text-destructive" : "text-primary-text")}>
                  {done.result === "copied" ? "Link copied" : done.result === "shared" ? "Shared" : "Copy this link to share it:"}
                </span>
              )}
              {done?.index === index && done.result === "failed" && leg.receipt && <ManualLink path={leg.receipt} />}
            </span>
            {leg.receipt && (
              <>
                <Link
                  href={leg.receipt}
                  onClick={() => rememberReturn(returnTo, leg.receipt!)}
                  aria-label={`View ${leg.name}'s receipt`}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary-text hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <ReceiptText className="h-[18px] w-[18px]" aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  onClick={() => void share(leg, index)}
                  aria-label={`Share ${leg.name}'s receipt`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary-fill px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-fill-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  {done?.index === index && done.result !== "failed" ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  Share
                </button>
              </>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">Nobody in this payment matches that.</li>}
      </ul>
    </Sheet>
  );
}
