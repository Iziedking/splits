"use client";

import { Check, Printer, Share2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BackLink } from "@/components/app/back-link";
import { networkName, PaymentDetails, shortHex } from "@/components/app/payment-details";
import { ManualLink, readReturn, receiptText, shareLink } from "@/components/app/receipt-share";
import { Button } from "@/components/ui/button";
import type { ReceiptView } from "@/lib/api";
import { purposeFill } from "@/lib/palette";

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
        <BackLink href={back} label="Back to payment" className="-mt-2 print:hidden" />
      )}
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-badge motion-safe:animate-[pop_420ms_cubic-bezier(0.34,1.4,0.64,1)_both] print:animate-none">
          <Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-title leading-tight font-extrabold">Received.</h1>
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
          <p style={lineIn(1)} className="enter figure mt-1 pb-2 text-figure-xl leading-none print:animate-none">
            ${receipt.amount}
          </p>
        </div>

        <div aria-hidden="true" className="mx-5 mt-3 border-t border-dashed border-foreground/15" />

        <dl className="divide-y divide-foreground/[0.07] px-5 pb-2">
          {!addressName && (
            <Row label="To" order={2}>
              {receipt.name}
            </Row>
          )}
          <Row label="From" order={3}>
            {receipt.from}
          </Row>
          <Row label="Paid" order={4}>
            <PaidAt iso={receipt.paidAt} />
          </Row>
          <Row label="Status" order={5}>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-primary" />
              {receipt.simulated ? "Paid (test)" : "Paid and checked"}
            </span>
          </Row>
        </dl>
        <PaymentDetails
          className="mx-3 mb-3"
          proofUrl={receipt.explorerUrl}
          rows={[
            { label: "To", value: receipt.to },
            { label: "From", value: receipt.fromAddress },
            { label: "Network", value: networkName(receipt.network) },
            { label: "Reference", value: receipt.txHash ? shortHex(receipt.txHash, 10) : "Test payment" },
          ]}
        />
      </section>

      <div className="space-y-3 print:hidden">
        <Button className="w-full" onClick={() => void share()}>
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
        {receipt.simulated ? "This is a test receipt. No money moved." : "Splits checked this payment before marking it paid."}{" "}
        <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-primary-text underline-offset-4 hover:underline print:hidden">
          Send money with Splits
        </Link>
      </p>
    </div>
  );
}
