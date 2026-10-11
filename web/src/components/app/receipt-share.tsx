"use client";

import { Check, ReceiptText, Share2, X } from "lucide-react";
import * as React from "react";
import type { TransferView } from "@/lib/api";
import { purposeFill } from "@/lib/palette";
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
      className="mt-2 min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    />
  );
}

export const receiptText = (leg: Pick<Leg, "amount" | "purpose" | "name">) =>
  `Receipt for $${leg.amount} to ${leg.name}${leg.purpose ? `, for ${leg.purpose}` : ""}. Paid with Splits on Arc.`;

/**
 * Pick whose receipt to share. Each link opens that person's part only, so the list is the
 * decision: one row per recipient, each with its own share and view.
 */
export function ShareReceipts({ legs, open, onClose }: { legs: Leg[]; open: boolean; onClose: () => void }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = React.useState("");
  const [done, setDone] = React.useState<{ index: number; result: "copied" | "shared" | "failed" } | null>(null);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

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
    <dialog
      ref={ref}
      onClose={() => {
        setDone(null);
        setFilter("");
        onClose();
      }}
      aria-labelledby="share-receipts-title"
      className="mx-auto mt-auto mb-0 w-full max-w-md rounded-t-[24px] bg-card p-0 text-card-foreground shadow-[0_24px_60px_-12px_rgb(14_28_43/0.35)] backdrop:bg-[#0e1c2b]/40 backdrop:backdrop-blur-[4px] open:motion-safe:animate-[rise_300ms_cubic-bezier(0.22,1,0.36,1)] sm:my-auto sm:w-[calc(100%-2rem)] sm:rounded-[24px] sm:open:motion-safe:animate-[pop_320ms_cubic-bezier(0.34,1.4,0.64,1)]"
    >
      <div className="flex max-h-[85dvh] flex-col p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="share-receipts-title" className="text-2xl font-bold">
              Share a receipt
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Each receipt shows one person&apos;s part, nobody else&apos;s.</p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="-m-2 rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {legs.length > 8 && (
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a name or address"
            aria-label="Find a recipient"
            className="mt-4 min-h-11 w-full rounded-full border border-border bg-white px-4 text-[15px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        )}

        <ul className="-mx-2 mt-4 min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {rows.map(({ leg, index }) => (
            <li key={index} className="flex items-center gap-3 px-2 py-3">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: purposeFill(index) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{leg.name}</span>
                <span className="block truncate text-sm text-muted-foreground tabular-nums">
                  ${leg.amount}
                  {leg.purpose && ` for ${leg.purpose}`}
                </span>
                {done?.index === index && (
                  <span role="status" className={cn("block text-sm font-semibold", done.result === "failed" ? "text-destructive" : "text-primary")}>
                    {done.result === "copied" ? "Link copied" : done.result === "shared" ? "Shared" : "Copy this link to share it:"}
                  </span>
                )}
                {done?.index === index && done.result === "failed" && leg.receipt && <ManualLink path={leg.receipt} />}
              </span>
              {leg.receipt && (
                <>
                  <a
                    href={leg.receipt}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View ${leg.name}'s receipt`}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <ReceiptText className="h-[18px] w-[18px]" aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void share(leg, index)}
                    aria-label={`Share ${leg.name}'s receipt`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-deep focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
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
      </div>
    </dialog>
  );
}
