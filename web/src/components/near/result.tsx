"use client";

import Link from "next/link";
import * as React from "react";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Notice } from "@/components/ui/field";
import { NEAR, txUrl } from "@/lib/near/config";
import { formatUnits, refusalText, splitsEvents, verifyPayment, type Leg, type Verdict } from "@/lib/near/payment";
import { finalTx } from "@/lib/near/rpc";
import { purposeFill } from "@/lib/palette";
import { Download } from "lucide-react";
import { paymentCsv } from "@/lib/near/csv";
import { download } from "./download";
import { AccountName, SplitBar } from "./split-card";

/** What the payer approved, kept across a wallet that redirects away and back. */
export type Pending = { payer: string; ref: string; legs: Leg[] | null; to?: string; total: string };

const KEY = "splits-near-pending";

export function savePending(p: Pending) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private mode: the in-page flow still works; only a redirecting wallet loses the check.
  }
}

export function takePending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

/** Some wallets (MyNearWallet) leave the page and come back with ?transactionHashes=. */
export function returnedHash(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  return p.get("transactionHashes")?.split(",").at(-1) ?? null;
}

type Check = { state: "checking" } | { state: "done"; verdict: Verdict } | { state: "error"; message: string };

/** Reads the final transaction from NEAR and compares it with what was approved. */
export function useVerify(hash: string | null, pending: Pending | null): Check | null {
  const [check, setCheck] = React.useState<Check | null>(null);
  React.useEffect(() => {
    if (!hash || !pending) return;
    const ctrl = new AbortController();
    setCheck({ state: "checking" });
    (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const tx = await finalTx(hash, pending.payer, ctrl.signal);
          const events = splitsEvents(tx, NEAR.router);
          setCheck({ state: "done", verdict: verifyPayment(events, { payer: pending.payer, ref: pending.ref, legs: pending.legs }) });
          return;
        } catch (e) {
          if (ctrl.signal.aborted) return;
          if (attempt === 5) setCheck({ state: "error", message: e instanceof Error ? e.message : "Could not read the result" });
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
    return () => ctrl.abort();
  }, [hash, pending]);
  return check;
}

export function PaymentResult({ hash, pending, check, onAgain }: { hash: string; pending: Pending; check: Check | null; onAgain: () => void }) {
  if (!check || check.state === "checking") {
    return (
      <div className="surface enter rounded-lg p-6" role="status">
        <p className="text-lg font-semibold">Checking the payment on NEAR…</p>
        <p className="mt-1 text-sm text-muted-foreground">
          NEAR finishes the router&apos;s transfers over a few blocks. This screen says &ldquo;Landed&rdquo; only once every part is final on chain and matches what you approved.
        </p>
        <TxLink hash={hash} />
      </div>
    );
  }
  if (check.state === "error") {
    return (
      <div className="surface rounded-2xl p-6 sm:p-7">
        <Notice tone="error">Could not read the result yet: {check.message}</Notice>
        <TxLink hash={hash} />
      </div>
    );
  }
  const v = check.verdict;
  if (v.kind === "refused") {
    return (
      <div className="surface rounded-2xl p-6 sm:p-7">
        <h2 className="text-2xl font-bold">Nothing was sent</h2>
        <p className="mt-2 text-muted-foreground">{refusalText(v.reason)} The token returned the full amount to you.</p>
        <TxLink hash={hash} />
        <Again onAgain={onAgain} />
      </div>
    );
  }
  if (v.kind === "mismatch" || v.kind === "unknown") {
    return (
      <div className="surface rounded-2xl p-6 sm:p-7">
        <Notice tone="error">This transaction does not match the payment you approved: {v.detail}. Check it on the explorer.</Notice>
        <TxLink hash={hash} />
      </div>
    );
  }
  return (
    <div className="enter space-y-5">
      <div className="surface rounded-2xl p-6 sm:p-7">
        <p className="text-sm font-medium text-primary-text">{v.kind === "landed" ? "Final on NEAR" : "Partly paid"}</p>
        <h2 className="display-face mt-1 text-3xl font-bold">{v.kind === "landed" ? "Landed, divided." : "Some parts came back to you"}</h2>
        <p className="figure mt-3 text-4xl">
          {formatUnits(v.paid)} <span className="text-lg font-semibold text-muted-foreground">{NEAR.tokenSymbol}</span>
        </p>
        {v.kind === "partly" && (
          <p className="mt-2 text-sm text-muted-foreground">
            {formatUnits(v.refunded)} {NEAR.tokenSymbol} could not be delivered and the token returned it to you. NEAR runs each part as its own transfer, so the others still landed.
          </p>
        )}
        {pending.to && <p className="mt-2 text-sm text-muted-foreground">Divided by {pending.to}&apos;s saved split.</p>}
        <SplitBar className="mt-5" weights={v.legs.map((l) => Number(BigInt(l.amount) / 10_000n) || 1)} />
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <TxLink hash={hash} />
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            onClick={() =>
              download(
                `splits-payment-${pending.ref}.csv`,
                paymentCsv({ legs: v.legs, payer: pending.payer, ref: pending.ref, tx: hash, token: NEAR.token, symbol: NEAR.tokenSymbol, network: NEAR.network, explorerTx: txUrl(hash), at: new Date() }),
              )
            }
          >
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Download CSV for your records
          </button>
        </div>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {v.legs.map((l, i) => (
          <li key={l.account_id} className="surface overflow-hidden rounded-2xl p-5 pt-6">
            <span aria-hidden="true" className="-mx-5 -mt-6 mb-5 block h-1" style={{ backgroundColor: purposeFill(i) }} />
            <div className="flex items-center gap-2">
              <PurposeDot index={i} />
              <AccountName id={l.account_id} className="font-medium" />
            </div>
            <p className="figure mt-3 text-2xl tabular-nums">{formatUnits(BigInt(l.amount))}</p>
            <p className="text-sm text-muted-foreground first-letter:uppercase">{l.purpose}</p>
            <p className={l.landed ? "mt-2 text-sm font-medium text-success-text" : "mt-2 text-sm font-medium text-destructive"}>
              {l.landed ? "Landed" : "Returned to you"}
            </p>
            {l.landed && (
              <Link className="mt-1 inline-block text-sm text-primary-text underline" href={`/near/r/${hash}?from=${encodeURIComponent(pending.payer)}&to=${encodeURIComponent(l.account_id)}`}>
                Their receipt
              </Link>
            )}
          </li>
        ))}
      </ul>
      <Again onAgain={onAgain} />
    </div>
  );
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a className="mt-3 inline-block text-sm text-primary-text underline" href={txUrl(hash)} target="_blank" rel="noreferrer">
      See the transaction on the NEAR explorer
    </a>
  );
}

function Again({ onAgain }: { onAgain: () => void }) {
  return (
    <button type="button" className="text-sm font-semibold text-primary-text underline" onClick={onAgain}>
      Make another payment
    </button>
  );
}
