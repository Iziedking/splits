import { ChevronDown, ExternalLink } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The fold for the technical facts of a payment: addresses, network, reference and the one public
 * proof link. Closed by default, so the screen reads as money; open, nothing is hidden. Everything
 * the consumer vocabulary leaves out lives in here (and only here), which `data-payment-details`
 * lets the vocabulary checks find.
 */
export function PaymentDetails({
  rows = [],
  proofUrl,
  summary = "Payment details",
  children,
  className,
}: {
  rows?: { label: string; value: React.ReactNode }[];
  /** Anything else that belongs in the fold, after the rows (an address with its QR). */
  children?: React.ReactNode;
  /** The public record of this payment (the block explorer), labelled "Proof of payment". */
  proofUrl?: string | null;
  summary?: string;
  className?: string;
}) {
  return (
    <details data-payment-details className={cn("group rounded-md bg-white/60 ring-1 ring-white print:bg-transparent print:ring-0", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-4 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none print:hidden [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      {rows.length > 0 && (
        <dl className="divide-y divide-foreground/[0.07] px-4 pb-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 py-2.5">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="text-right break-all tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="px-4 pb-4">{children}</div>}
      {proofUrl && (
        <a
          href={proofUrl}
          target="_blank"
          rel="noreferrer"
          className="mx-4 mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary-text underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none print:hidden"
        >
          Proof of payment
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
    </details>
  );
}

/** "0x8eDb…64F2" for a long hex string. */
export const shortHex = (value: string, head = 6) => `${value.slice(0, head)}…${value.slice(-4)}`;

/** The network as people outside Splits know it. */
export const networkName = (network: string) => (network === "arc" ? "Arc" : "Arc Testnet");
