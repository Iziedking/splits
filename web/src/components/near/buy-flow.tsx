"use client";

import { ShoppingBag } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { legsFor, MAX_BUTTON_UNITS, type ButtonConfig } from "@/lib/near/button";
import { NEAR } from "@/lib/near/config";
import { buildPayTx, CENT, formatNear, formatUnits, nearNeededForGas, newRef, parseCents, formatDollars } from "@/lib/near/payment";
import { getAccount, isRegistered, spendable, tokenBalance } from "@/lib/near/rpc";
import { PaymentResult, returnedHash, savePending, takePending, useVerify, type Pending } from "./result";
import { SharesList } from "./split-flow";
import { useNearWallet } from "./wallet";

/**
 * The page a "Pay with Splits" button opens. The payer sees the shop, the price and exactly who
 * gets which part of the sale, approves once, and watches each part land. `back` is where the
 * payer returns afterwards (the shop's own page when it is on this site).
 */
export function BuyFlow({ config, back }: { config: ButtonConfig; back: { href: string; label: string } | null }) {
  const { accountId, kind, signIn, send } = useNearWallet();
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hash, setHash] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const check = useVerify(hash, pending);

  React.useEffect(() => {
    const h = returnedHash();
    const p = h ? takePending() : null;
    if (h && p) {
      setPending(p);
      setHash(h);
      // Keep the checkout in the address bar; drop only what the wallet added.
      const url = new URL(window.location.href);
      url.searchParams.delete("transactionHashes");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);

  if (hash && pending) {
    return <PaymentResult hash={hash} pending={pending} check={check} done={back ?? undefined} onAgain={() => (setHash(null), setPending(null))} />;
  }

  const typed = parseCents(amount);
  const units = config.amount ?? (typed === null ? null : typed * CENT);
  const tooBig = units !== null && units > MAX_BUTTON_UNITS;
  const shares = config.parts.map((p) => ({ account_id: p.account, bps: p.bps, purpose: p.purpose }));

  async function onPay() {
    if (units === null || !accountId) return;
    setError(null);
    setBusy(true);
    try {
      const legs = legsFor(config, units);
      if (legs.some((l) => BigInt(l.amount) === 0n)) throw new Error("That amount is too small to give every part something. Try a larger one.");
      const unregistered = (await Promise.all(legs.map(async (l) => ((await isRegistered(l.account_id)) ? null : l.account_id)))).filter((a): a is string => a !== null);
      const [balance, me] = await Promise.all([tokenBalance(accountId), getAccount(accountId)]);
      if (balance < units) throw new Error(`You have ${formatDollars(balance)}; this needs ${formatDollars(units)}.`);
      const needed = nearNeededForGas(legs.length);
      if (kind !== "email" && (!me || spendable(me) < needed)) throw new Error(`Your wallet needs about ${formatNear(needed)} NEAR free for fees.`);
      const ref = newRef();
      const p: Pending = { payer: accountId, ref, legs, total: units.toString() };
      savePending(p);
      const h = await send(buildPayTx({ token: NEAR.token, router: NEAR.router, total: units, msg: { ref, legs }, parts: legs.length, unregistered }));
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
            <ShoppingBag className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Pay {config.shop}</p>
            <h1 className="text-xl font-semibold">{config.item ?? "Checkout"}</h1>
          </div>
        </div>

        {config.amount !== null ? (
          <p className="figure mt-6 text-figure-lg tabular-nums">
            {formatUnits(config.amount)} <span className="text-lg font-semibold text-muted-foreground">{NEAR.tokenSymbol}</span>
          </p>
        ) : (
          <Field
            className="mt-6"
            label={`Amount (${NEAR.tokenSymbol})`}
            inputMode="decimal"
            placeholder="25.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amount && typed === null ? "Enter an amount like 25 or 12.50" : tooBig ? `The most for one checkout is ${formatUnits(MAX_BUTTON_UNITS)}` : null}
          />
        )}

        <p className="mt-5 text-sm text-muted-foreground">Your payment divides as it arrives:</p>
        <SharesList shares={shares} example={units ?? 100_000_000n} />

        {accountId ? (
          <Button className="mt-5 w-full" busy={busy} disabled={units === null || units < CENT || tooBig} onClick={() => void onPay()}>
            {units === null ? "Pay" : `Pay ${formatDollars(units)}`}
          </Button>
        ) : (
          <Button className="mt-5 w-full" onClick={() => void signIn()}>
            Sign in to pay
          </Button>
        )}
        <p className="mt-3 text-xs text-muted-foreground">You approve once. Each part goes straight to its owner; Splits never holds the money.</p>
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
      </div>
    </div>
  );
}
