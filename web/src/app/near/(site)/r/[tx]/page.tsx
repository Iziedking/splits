import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/near/print-button";
import { PurposeDot } from "@/components/app/purpose-dot";
import { AccountName, SplitBar } from "@/components/near/split-card";
import { purposeFill } from "@/lib/palette";
import { Notice } from "@/components/ui/field";
import { NEAR, accountUrl, txUrl } from "@/lib/near/config";
import { formatUnits, isAccountId, splitsEvents } from "@/lib/near/payment";
import { finalTx } from "@/lib/near/rpc";

export const metadata: Metadata = { title: "Receipt", robots: { index: false } };

type Props = { params: Promise<{ tx: string }>; searchParams: Promise<{ from?: string; to?: string }> };

type Part = { recipient: string; amount: string; purpose: string; landed: boolean };
type Payment = { payer: string; ref: string; split_owner: string | null; total: string; paid: string; legs: Part[] };

/**
 * A receipt read straight from NEAR: the router's `payment` event in this transaction. With `to`,
 * it shows that person only their own part; without, the whole payment.
 */
export default async function NearReceiptPage({ params, searchParams }: Props) {
  const { tx } = await params;
  const { from, to } = await searchParams;
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(tx) || !from || !isAccountId(from) || (to && !isAccountId(to))) notFound();

  let payment: Payment | null = null;
  let failed: string | null = null;
  try {
    const outcome = await finalTx(tx, from);
    const ev = splitsEvents(outcome, NEAR.router).find((e) => e.event === "payment");
    payment = ev ? (ev.data as unknown as Payment) : null;
  } catch (e) {
    failed = e instanceof Error ? e.message : "NEAR did not answer";
  }

  if (failed) {
    return (
      <div className="surface mx-auto max-w-xl rounded-lg p-6">
        <Notice tone="error">Could not read this transaction from NEAR: {failed}</Notice>
      </div>
    );
  }
  if (!payment) notFound();

  const parts = to ? payment.legs.filter((l) => l.recipient === to) : payment.legs;
  if (to && parts.length === 0) notFound();

  return (
    <article className="surface enter mx-auto max-w-xl overflow-hidden rounded-2xl p-6 sm:p-8">
      {to ? (
        <span
          aria-hidden="true"
          className="-mx-6 -mt-6 mb-6 block h-1.5 sm:-mx-8 sm:-mt-8 sm:mb-8"
          style={{ backgroundColor: purposeFill(Math.max(0, payment.legs.findIndex((l) => l.recipient === to))) }}
        />
      ) : (
        <SplitBar className="mb-6" weights={payment.legs.map((l) => Number(BigInt(l.amount) / 10_000n) || 1)} />
      )}
      <p className="text-sm font-medium text-primary-text">Receipt · NEAR {NEAR.network}</p>
      {to ? (
        <>
          <h1 className="display-face mt-1 text-3xl font-bold">
            {parts[0]!.landed ? "You were paid" : "This part was not delivered"}
          </h1>
          <p className="figure mt-4 text-5xl">
            {formatUnits(BigInt(parts[0]!.amount))} <span className="text-xl text-muted-foreground">{NEAR.tokenSymbol}</span>
          </p>
          <dl className="mt-6 space-y-3 text-sm">
            <Row label="For">{parts[0]!.purpose}</Row>
            <Row label="To">
              <a className="font-mono text-[0.8125rem] underline underline-offset-4" href={accountUrl(to)} target="_blank" rel="noreferrer">
                {to}
              </a>
            </Row>
            <Row label="From">
              <span className="font-mono text-[0.8125rem]">{payment.payer}</span>
            </Row>
            {payment.split_owner && (
              <Row label="Divided by">
                <span className="font-mono text-[0.8125rem]">{payment.split_owner}</span>&apos;s saved split
              </Row>
            )}
            <Row label="Reference">
              <span className="font-mono text-[0.8125rem]">{payment.ref}</span>
            </Row>
          </dl>
          <p className="mt-6 text-xs text-muted-foreground">This receipt shows only your part. The other parts of the payment are not shown here.</p>
        </>
      ) : (
        <>
          <h1 className="display-face mt-1 text-3xl font-bold">Payment of {formatUnits(BigInt(payment.total))} {NEAR.tokenSymbol}</h1>
          <p className="mt-1 text-sm text-muted-foreground">From {payment.payer}{payment.split_owner ? `, divided by ${payment.split_owner}'s saved split` : ""}.</p>
          <ul className="mt-5 divide-y divide-foreground/8">
            {parts.map((l, i) => (
              <li key={l.recipient} className="flex items-center gap-3 py-3">
                <PurposeDot index={i} />
                <div className="min-w-0 flex-1">
                  <AccountName id={l.recipient} className="font-medium" />
                  <p className="text-xs text-muted-foreground">{l.purpose} · {l.landed ? "landed" : "returned to payer"}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatUnits(BigInt(l.amount))}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        <a className="text-sm text-primary-text underline" href={txUrl(tx)} target="_blank" rel="noreferrer">
          Check it on the NEAR explorer
        </a>
        <PrintButton />
      </div>
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-foreground/8 pb-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium break-all">{children}</dd>
    </div>
  );
}
