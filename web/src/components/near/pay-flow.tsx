"use client";

import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { NEAR } from "@/lib/near/config";
import { buildPayTx, CENT, formatNear, formatUnits, nearNeededForGas, newRef, parseCents } from "@/lib/near/payment";
import { getAccount, getSplit, isRegistered, spendable, tokenBalance, type SavedSplit } from "@/lib/near/rpc";
import { PaymentResult, returnedHash, savePending, takePending, useVerify, type Pending } from "./result";
import { SharesList } from "./split-flow";
import { useNearWallet } from "./wallet";

/**
 * A pay link: anyone pays `owner`, and the router divides the money by the split `owner` saved.
 * The payer sees the split and its version; if it changes before the payment lands, the router
 * refuses it and the token returns the money.
 */
export function PayFlow({ owner, checkout = false }: { owner: string; checkout?: boolean }) {
  const { accountId, signIn, send } = useNearWallet();
  const [split, setSplit] = React.useState<SavedSplit | null | undefined>(undefined);
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hash, setHash] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const check = useVerify(hash, pending);

  React.useEffect(() => {
    getSplit(owner).then(setSplit, () => setSplit(null));
    const h = returnedHash();
    const p = h ? takePending() : null;
    if (h && p) {
      setPending(p);
      setHash(h);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [owner]);

  if (hash && pending) return <PaymentResult hash={hash} pending={pending} check={check} onAgain={() => (setHash(null), setPending(null))} />;

  const cents = parseCents(amount);
  const units = cents === null ? null : cents * CENT;

  async function onPay() {
    if (!split || units === null || !accountId) return;
    setError(null);
    setBusy(true);
    try {
      const unregistered = (
        await Promise.all(split.shares.map(async (s) => ((await isRegistered(s.account_id)) ? null : s.account_id)))
      ).filter((a): a is string => a !== null);
      const [balance, me] = await Promise.all([tokenBalance(accountId), getAccount(accountId)]);
      if (balance < units) throw new Error(`You have ${formatUnits(balance)} ${NEAR.tokenSymbol}; this payment needs ${formatUnits(units)}.`);
      const needed = nearNeededForGas(split.shares.length);
      if (!me || spendable(me) < needed) throw new Error(`Your wallet needs about ${formatNear(needed)} NEAR free for gas.`);
      const ref = newRef();
      const p: Pending = { payer: accountId, ref, legs: null, to: owner, total: units.toString() };
      savePending(p);
      const h = await send(
        buildPayTx({ token: NEAR.token, router: NEAR.router, total: units, msg: { ref, to: owner, version: split.version }, parts: split.shares.length, unregistered }),
      );
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
      <div className="surface rounded-2xl p-6 sm:p-7">
        <p className="text-sm font-medium text-primary-text">Pay</p>
        <h1 className="mt-1 font-mono text-2xl font-semibold break-all sm:text-3xl">{owner}</h1>
        {split === undefined && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
        {split === null && <Notice className="mt-4">{owner} hasn&apos;t set up a split yet, so there&apos;s nothing to pay into. Ask them for their Splits pay link.</Notice>}
        {split && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">Whatever you pay divides automatically like this:</p>
            <SharesList shares={split.shares} example={units ?? 100_000_000n} />
            <Field className="mt-5" label={`Amount (${NEAR.tokenSymbol})`} inputMode="decimal" placeholder="25.00" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && cents === null ? "Enter an amount like 25 or 12.50" : null} />
            {accountId ? (
              <Button className="mt-4 w-full" busy={busy} disabled={units === null || units < CENT} onClick={() => void onPay()}>
                {units === null ? "Pay" : `Pay ${formatUnits(units)} ${NEAR.tokenSymbol}`}
              </Button>
            ) : (
              <Button className="mt-4 w-full" onClick={() => void signIn()}>
                Connect a NEAR wallet to pay
              </Button>
            )}
            <p className="mt-3 text-xs text-muted-foreground">You approve once in your wallet, and the money divides as it arrives.</p>
            {checkout && (
              <p className="mt-3 text-sm">
                <Link className="font-medium text-primary-text underline-offset-4 hover:underline" href={`/near/checkout/${owner}`}>
                  Pay from another chain instead
                </Link>{" "}
                <span className="text-muted-foreground">(USDC, USDT, ETH, SOL and more)</span>
              </p>
            )}
          </>
        )}
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
      </div>
    </div>
  );
}
