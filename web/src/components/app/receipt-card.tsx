"use client";

import { ArrowLeft, Check, ExternalLink, Printer, Share2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ManualLink, readReturn, receiptText, shareLink } from "@/components/app/receipt-share";
import { Button } from "@/components/ui/button";
import type { ReceiptView } from "@/lib/api";
import { purposeFill } from "@/lib/palette";

const short = (value: string, head = 6) => `${value.slice(0, head)}…${value.slice(-4)}`;
/**
 * The reveal is CSS, not script: it starts on first paint, so the receipt is readable without
 * JavaScript, in print, and in link previews. Lines settle in reading order.
 */
const lineIn = (order: number): React.CSSProperties => ({ animationDelay: `${120 + order * 45}ms` });

/** The paid time in the reader's own time zone, once the page is in their browser. */
function PaidAt({ iso }: { iso: string }) {
  const [text, setText] = React.useState(() => new Date(iso).toUTCString().replace(" GMT", " UTC").slice(5));
  React.useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}

function Row({ label, order, children }: { label: string; order: number; children: React.ReactNode }) {
  return (
    <div style={lineIn(order)} className="enter flex items-start justify-between gap-4 py-3 print:animate-none">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-ui font-medium">{children}</dd>
    </div>
  );
}

/**
 * One recipient's receipt (UI_BRIEF.md v4, "Receipts"). The colour stripe is the same colour the
 * part had on the sender's screen, so the receipt reads as one slice of a payment.
 */
export function ReceiptCard({ receipt }: { receipt: ReceiptView }) {
  const [shared, setShared] = React.useState<"copied" | "shared" | "failed" | null>(null);
  const [back, setBack] = React.useState<string | null>(null);
  React.useEffect(() => setBack(readReturn(window.location.pathname)), []);
  const fill = purposeFill(receipt.index);
  const addressName = /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i.test(receipt.name);

  async function share() {
    const result = await shareLink(window.location.pathname, receiptText(receipt));
    if (result !== "cancelled") setShared(result);
  }

  return (
    <div className="space-y-6 pt-4">
      {back && (
        <Link
          href={back}
          className="-mt-2 -ml-2 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none print:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to payment
        </Link>
      )}
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-badge motion-safe:animate-[pop_420ms_cubic-bezier(0.34,1.4,0.64,1)_both] print:animate-none">
          <Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-title leading-tight font-extrabold">Received on Arc.</h1>
        <p className="mt-1 text-muted-foreground">
          {receipt.whole
            ? `A payment from ${receipt.from}.`
            : `${addressName ? "One part" : `${receipt.name}'s part`} of a payment from ${receipt.from}.`}
        </p>
      </div>

      <section aria-label="Receipt" style={lineIn(-1)} className="surface enter overflow-hidden print:animate-none print:border print:shadow-none">
        <span aria-hidden="true" className="block h-1.5 w-full" style={{ backgroundColor: fill }} />
        <div className="px-5 pt-5 pb-2">
          <p style={lineIn(0)} className="enter text-sm text-muted-foreground print:animate-none">
            {receipt.purpose ? `For ${receipt.purpose}` : "Payment"}
          </p>
          <p style={lineIn(1)} className="enter figure mt-1 text-figure-xl leading-none print:animate-none">
            ${receipt.amount}
          </p>
          <p style={lineIn(1)} className="enter mt-2 text-sm text-muted-foreground print:animate-none">
            USDC
          </p>
        </div>

        <div aria-hidden="true" className="mx-5 mt-3 border-t border-dashed border-foreground/15" />

        <dl className="divide-y divide-foreground/[0.07] px-5 pb-2">
          <div style={lineIn(2)} className="enter print:animate-none grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 py-3">
            <dt className="text-sm text-muted-foreground">To</dt>
            {!addressName && <dd className="truncate text-right text-ui font-medium">{receipt.name}</dd>}
            <dd className="col-span-2 mt-1.5 rounded-lg bg-foreground/[0.04] px-2.5 py-1.5 text-micro leading-snug break-all text-muted-foreground tabular-nums">
              {receipt.to}
            </dd>
          </div>
          <Row label="From" order={3}>
            <span className="block">{receipt.from}</span>
            <span className="block text-sm text-muted-foreground tabular-nums">{short(receipt.fromAddress)}</span>
          </Row>
          <Row label="Paid" order={4}>
            <PaidAt iso={receipt.paidAt} />
          </Row>
          <Row label="Network" order={5}>{receipt.network === "arc" ? "Arc" : "Arc Testnet"}</Row>
          <Row label="Transaction" order={6}>
            {receipt.explorerUrl && receipt.txHash ? (
              <a
                href={receipt.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary-text tabular-nums underline-offset-4 hover:underline"
              >
                {short(receipt.txHash, 8)}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-muted-foreground">Simulated in preview</span>
            )}
          </Row>
          <Row label="Status" order={7}>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-primary" />
              {receipt.simulated ? "Settled (simulated)" : "Settled and checked"}
            </span>
          </Row>
        </dl>
      </section>

      <div className="space-y-3 print:hidden">
        {receipt.explorerUrl ? (
          <a
            href={receipt.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-primary-fill px-6 text-ui font-semibold text-primary-foreground shadow-pill hover:bg-primary-fill-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            View on Arc explorer
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
        <Button variant={receipt.explorerUrl ? "secondary" : "primary"} className="w-full" onClick={() => void share()}>
          {shared === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
          {shared === "copied" ? "Link copied" : "Share receipt"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print or save as PDF
        </Button>
        <div role="status" className="text-sm">
          {shared === "failed" && (
            <>
              <span className="font-semibold">Copy this link to share it:</span>
              <ManualLink path={window.location.pathname} />
            </>
          )}
        </div>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        {receipt.explorerUrl
          ? "Splits checked this payment against the Arc transaction before showing it as settled."
          : "This receipt comes from a preview server, so no money moved."}{" "}
        <Link href="/" className="font-semibold text-primary-text underline-offset-4 hover:underline print:hidden">
          Send money with Splits
        </Link>
      </p>
    </div>
  );
}
