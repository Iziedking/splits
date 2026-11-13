"use client";

import { Check, Clock, ReceiptText } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { billLeg, billRef, hostShare, type Bill } from "@/lib/near/bill";
import { NEAR } from "@/lib/near/config";
import { buildPayTx, formatNear, nearNeededForGas, formatDollars } from "@/lib/near/payment";
import { getAccount, isRefUsed, isRegistered, spendable, tokenBalance } from "@/lib/near/rpc";
import { cn } from "@/lib/utils";
import { PaymentResult, returnedHash, savePending, takePending, useVerify, type Pending } from "./result";
import { AccountName } from "./split-card";
import { useNearWallet } from "./wallet";

/** Who on the bill has paid, read from the router every few seconds. Null until the first read. */
function usePaid(bill: Bill): boolean[] | null {
  const [paid, setPaid] = React.useState<boolean[] | null>(null);
  React.useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    async function read() {
      try {
        const out = await Promise.all(bill.people.map((p, i) => isRefUsed(p.account, billRef(bill, i), ctrl.signal)));
        if (live) setPaid(out);
      } catch {
        // A slow RPC answer; the next read tries again.
      }
    }
    void read();
    const t = setInterval(read, 8000);
    return () => {
      live = false;
      ctrl.abort();
      clearInterval(t);
    };
  }, [bill]);
  return paid;
}

/**
 * A shared bill. Everyone sees who has paid and who has not. A friend on the bill connects their
 * account and pays their part to the friend who paid, in one approval.
 */
export function TabFlow({ bill }: { bill: Bill }) {
  const { accountId, kind, signIn, send } = useNearWallet();
  const paid = usePaid(bill);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hash, setHash] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [here, setHere] = React.useState("/near/tab");
  const check = useVerify(hash, pending);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("transactionHashes");
    setHere(url.pathname + url.search);
    const h = returnedHash();
    const p = h ? takePending() : null;
    if (h && p) {
      setPending(p);
      setHash(h);
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);

  if (hash && pending) {
    return <PaymentResult hash={hash} pending={pending} check={check} done={{ href: here, label: "Back to the bill", onClick: () => (setHash(null), setPending(null)) }} onAgain={() => (setHash(null), setPending(null))} />;
  }

  const mine = accountId ? bill.people.findIndex((p) => p.account === accountId) : -1;
  const isHost = accountId === bill.host;
  const back = paid ? bill.people.reduce((a, p, i) => a + (paid[i] ? p.amount : 0n), 0n) : 0n;
  const owed = bill.total - hostShare(bill);
  const count = paid ? paid.filter(Boolean).length : 0;

  async function onPay() {
    if (!accountId || mine < 0) return;
    setError(null);
    setBusy(true);
    try {
      const leg = billLeg(bill, mine);
      const units = BigInt(leg.amount);
      const ref = billRef(bill, mine);
      if (await isRefUsed(accountId, ref)) throw new Error("You have already paid your part of this bill.");
      const [balance, me, hostReady] = await Promise.all([tokenBalance(accountId), getAccount(accountId), isRegistered(bill.host)]);
      if (balance < units) throw new Error(`You have ${formatDollars(balance)}; your part is ${formatDollars(units)}.`);
      const needed = nearNeededForGas(1);
      if (kind !== "email" && (!me || spendable(me) < needed)) throw new Error(`Your wallet needs about ${formatNear(needed)} NEAR free for fees.`);
      const p: Pending = { payer: accountId, ref, legs: [leg], total: leg.amount };
      savePending(p);
      const h = await send(buildPayTx({ token: NEAR.token, router: NEAR.router, total: units, msg: { ref, legs: [leg] }, parts: 1, unregistered: hostReady ? [] : [bill.host] }));
      takePending();
      setPending(p);
      setHash(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The payment did not go through");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="surface enter rounded-3xl p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-fill/10 text-primary-text">
            <ReceiptText className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{bill.hostName} paid for</p>
            <h1 className="text-xl font-semibold">{bill.title}</h1>
          </div>
        </div>

        <p className="figure mt-6 text-figure-lg tabular-nums">
          {formatDollars(bill.total)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
          {paid === null
            ? "Checking who has paid…"
            : count === bill.people.length
              ? `Everyone has paid. ${bill.hostName} is square.`
              : `${count} of ${bill.people.length} paid · ${formatDollars(back)} of ${formatDollars(owed)} back to ${bill.hostName}`}
        </p>

        <ul className="mt-5 divide-y divide-white rounded-2xl bg-white/60 ring-1 ring-white">
          {bill.people.map((p, i) => {
            const done = paid?.[i] === true;
            return (
              <li key={p.account} className={cn("flex items-center gap-3 px-4 py-3", i === mine && "bg-primary-fill/5")}>
                <span
                  aria-hidden="true"
                  className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", done ? "pop bg-success-text/10 text-success-text" : "bg-muted text-muted-foreground")}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Clock className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.name}
                    {i === mine && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <AccountName id={p.account} className="text-muted-foreground" />
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{formatDollars(p.amount)}</p>
                  <p className={cn("text-xs", done ? "text-success-text" : "text-muted-foreground")}>{paid === null ? " " : done ? "Paid" : "Not yet"}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-5">
          {!accountId ? (
            <>
              <Button className="w-full" onClick={() => void signIn()}>
                Sign in to pay your part
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">Use the account next to your name. Your part goes straight to {bill.hostName}; Splits never holds the money.</p>
            </>
          ) : isHost ? (
            <Notice>This is your bill. Share its link in your group chat; each name turns to Paid as the money reaches you.</Notice>
          ) : mine < 0 ? (
            <Notice>
              This account is not on this bill. Sign in with the account next to your name, or ask {bill.hostName} to add this one.
            </Notice>
          ) : paid?.[mine] ? (
            <Notice tone="success">You have paid your part. Thank you!</Notice>
          ) : (
            <>
              <Button className="w-full" busy={busy} onClick={() => void onPay()}>
                Pay my part, {formatDollars(bill.people[mine]!.amount)}
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">You approve once. It goes straight to {bill.hostName}.</p>
            </>
          )}
          {error && (
            <Notice tone="error" className="mt-3">
              {error}
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}
