"use client";

import Link from "next/link";
import * as React from "react";
import { Check, Clock, Copy, Download, X } from "lucide-react";
import { PaymentDetails } from "@/components/app/payment-details";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Button, ButtonLink } from "@/components/ui/button";
import { NEAR, txUrl } from "@/lib/near/config";
import { refusalText, splitsEvents, verifyPayment, type Leg, type Verdict, formatDollars } from "@/lib/near/payment";
import { finalTx } from "@/lib/near/rpc";
import { paymentCsv } from "@/lib/near/csv";
import { cn } from "@/lib/utils";
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

/**
 * The end of a payment, the way a banking app shows it: a clear outcome, the amount, who got what,
 * and the technical record folded away under "Details" for anyone who wants it.
 */
export function PaymentResult({
  hash,
  pending,
  check,
  onAgain,
  done = DONE,
}: {
  hash: string;
  pending: Pending;
  check: Check | null;
  onAgain: () => void;
  /** Where "Done" goes: Home in the app, or back to the shop for a checkout. */
  done?: { href: string; label: string };
}) {
  if (!check || check.state === "checking") {
    return (
      <Panel>
        <div role="status" className="flex flex-col items-center py-6 text-center">
          <span aria-hidden="true" className="h-14 w-14 motion-safe:animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <h2 className="mt-6 text-xl font-semibold">Confirming your payment</h2>
          <p className="mt-1 text-sm text-muted-foreground">This usually takes a few seconds.</p>
        </div>
      </Panel>
    );
  }
  if (check.state === "error") {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        <Panel>
          <Outcome tone="wait" title="We couldn't confirm it yet" text="Your payment may still be on its way. Check again in a minute; nothing is charged twice." />
        </Panel>
        <Details hash={hash} />
        <Actions done={done} onAgain={onAgain} again="Try again" />
      </div>
    );
  }
  const v = check.verdict;
  if (v.kind === "refused") {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        <Panel>
          <Outcome tone="stop" title="Nothing was sent" text={`${refusalText(v.reason)} The full amount stayed with you.`} />
        </Panel>
        <Details hash={hash} />
        <Actions done={done} onAgain={onAgain} again="Try again" />
      </div>
    );
  }
  if (v.kind === "mismatch" || v.kind === "unknown") {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        <Panel>
          <Outcome tone="stop" title="Something doesn't match" text={`This payment is not the one you approved (${v.detail}). Please don't pay again until you've checked it.`} />
        </Panel>
        <Details hash={hash} />
        <Actions done={done} onAgain={onAgain} again="Start again" />
      </div>
    );
  }

  const landed = v.kind === "landed";
  const people = v.legs.length;
  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <Panel>
        <Outcome
          tone={landed ? "done" : "wait"}
          title={landed ? "Payment sent" : "Sent, with part returned"}
          text={
            landed
              ? `Split between ${people} ${people === 1 ? "person" : "people"}${pending.to ? ` by ${pending.to}'s saved split` : ""}.`
              : `${formatDollars(v.refunded)} couldn't be delivered and came back to you. The other parts arrived.`
          }
          amount={formatDollars(v.paid)}
        />
        <SplitBar className="mt-6" weights={v.legs.map((l) => Number(BigInt(l.amount) / 10_000n) || 1)} />
      </Panel>

      <ul className="surface divide-y divide-foreground/8 rounded-3xl px-2" aria-label="Who received what">
        {v.legs.map((l, i) => (
          <li key={l.account_id} className="enter flex items-center gap-3 px-3 py-4" style={{ animationDelay: `${120 + i * 70}ms` }}>
            <PurposeDot index={i} />
            <div className="min-w-0 flex-1">
              <AccountName id={l.account_id} className="font-medium" />
              <p className="text-sm text-muted-foreground first-letter:uppercase">
                {l.purpose}
                {!l.landed && <span className="text-destructive"> · returned to you</span>}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">{formatDollars(BigInt(l.amount))}</p>
              {l.landed && (
                <Link
                  className="text-sm font-medium text-primary-text underline-offset-4 hover:underline"
                  href={`/near/r/${hash}?from=${encodeURIComponent(pending.payer)}&to=${encodeURIComponent(l.account_id)}`}
                >
                  Receipt
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Details
        hash={hash}
        csv={() =>
          download(
            `splits-payment-${pending.ref}.csv`,
            paymentCsv({ legs: v.legs, payer: pending.payer, ref: pending.ref, tx: hash, token: NEAR.token, symbol: NEAR.tokenSymbol, network: NEAR.network, explorerTx: txUrl(hash), at: new Date() }),
          )
        }
      />
      <Actions done={done} onAgain={onAgain} again="Pay again" />
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="surface enter mx-auto w-full max-w-xl rounded-3xl p-6 sm:p-8">{children}</div>;
}

/** The outcome at a glance: a mark that draws itself, a title, the amount and one plain sentence. */
function Outcome({ tone, title, text, amount }: { tone: "done" | "wait" | "stop"; title: string; text: string; amount?: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-full motion-safe:animate-[pop_420ms_cubic-bezier(0.34,1.4,0.64,1)_both]",
          tone === "done" ? "bg-success/15 text-success-text" : tone === "wait" ? "bg-primary/10 text-primary-text" : "bg-destructive/10 text-destructive",
        )}
      >
        {tone === "done" ? (
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path className="draw" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : tone === "wait" ? (
          <Clock className="h-8 w-8" strokeWidth={2} />
        ) : (
          <X className="h-8 w-8" strokeWidth={2.5} />
        )}
      </span>
      <h2 className="mt-5 text-2xl font-bold">{title}</h2>
      {amount && (
        <p className="figure mt-2 text-figure-lg tabular-nums">
          {amount}
        </p>
      )}
      <p className="mt-2 max-w-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/** The technical record, folded the way the main app folds it: reference, proof, and a file. */
export function Details({ hash, csv }: { hash: string; csv?: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const reference = (
    <button
      type="button"
      aria-label={copied ? "Reference copied" : "Copy the reference"}
      className="inline-flex min-h-9 items-center gap-1.5 font-mono text-micro"
      onClick={() =>
        void navigator.clipboard?.writeText(hash).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {hash.slice(0, 6)}…{hash.slice(-6)}
      {copied ? <Check className="h-4 w-4 text-success-text" aria-hidden="true" /> : <Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
    </button>
  );
  return (
    <PaymentDetails className="surface mx-auto w-full max-w-xl" rows={[{ label: "Reference", value: reference }]} proofUrl={txUrl(hash)} proofLabel="View proof">
      {csv && (
        <button type="button" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary-text underline-offset-4 hover:underline" onClick={csv}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download for your records
        </button>
      )}
    </PaymentDetails>
  );
}

const DONE = { href: "/near/app", label: "Done" };

function Actions({ onAgain, again, done }: { onAgain: () => void; again: string; done: { href: string; label: string } }) {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-3 sm:grid-cols-2">
      <ButtonLink href={done.href} className="w-full">
        {done.label}
      </ButtonLink>
      <Button variant="secondary" className="w-full" onClick={onAgain}>
        {again}
      </Button>
    </div>
  );
}
