"use client";

import { ArrowDownToLine, ArrowUpFromLine, ExternalLink } from "lucide-react";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { BackLink } from "@/components/app/back-link";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
import { Segmented } from "@/components/app/segmented";
import { Skeleton } from "@/components/app/skeleton";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage, type EarnMoveView, type EarnStatus } from "@/lib/api";
import { cents, nearestCents } from "@/lib/format";

export default function EarnPage() {
  return (
    <AppFrame>
      <Earn />
    </AppFrame>
  );
}

const pct = (apy: number) => `${(apy * 100).toFixed(2)}%`;

const LABEL: Record<EarnMoveView["kind"], string> = { in: "Moved in", out: "Moved out", deposit: "Put in the vault" };

type Pending = { actionId: string; amount: string; kind: "in" | "out" };

/**
 * The Earning pocket: an opt-in pocket whose money is lent through a vetted Morpho vault on Arc with
 * Arc Earn Kit. Amounts are approximate (vault shares round) and the rate is variable. Moves in and
 * out are approved with the PIN or a passkey, like a payment, and carry no Splits fee.
 */
function Earn() {
  const { me, refresh } = useMe();
  const [data, setData] = React.useState<{ status: EarnStatus; moves: EarnMoveView[] } | null>(null);
  /** Why the pocket could not be read. Cleared by the next successful read. */
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /** Why a move or the switch-on failed. Separate, so a later poll does not hide it. */
  const [error, setError] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<"in" | "out">("in");
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<Pending | null>(null);

  const load = React.useCallback(async () => {
    try {
      setData(await api("/api/earn"));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/earn/pocket", { body: {} });
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ action: { id: string } }>("/api/earn/moves", { body: { kind, amount: amount.trim() } });
      setPending({ actionId: r.action.id, amount: amount.trim(), kind });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(proof: Proof) {
    if (!pending) return;
    await api("/api/earn/moves/confirm", { body: { actionId: pending.actionId, ...proof } });
    setPending(null);
    setAmount("");
    await Promise.all([load(), refresh()]);
  }

  // Until the first read lands: a skeleton, or the reason it failed with a way to try again. The
  // error must never hide behind the skeleton; the poll keeps trying either way.
  if (!data) {
    return (
      <div className="enter space-y-6 pt-4">
        <BackLink fallback="/home" />
        <h1 className="text-title leading-tight font-extrabold">Earning pocket</h1>
        {loadError ? (
          <div className="space-y-4">
            <Notice tone="error">{loadError}</Notice>
            <Button variant="secondary" className="w-full" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <Skeleton label="Loading your Earning pocket" className="h-40" />
        )}
      </div>
    );
  }
  const { status, moves } = data;

  return (
    <div className="enter space-y-6 pt-4">
      <BackLink fallback="/home" />
      <h1 className="text-title leading-tight font-extrabold">Earning pocket</h1>
      {error && <Notice tone="error">{error}</Notice>}

      {!status.available ? (
        <Notice>The Earning pocket isn&apos;t available yet.</Notice>
      ) : !status.pocket ? (
        <section aria-labelledby="earn-intro" className="surface space-y-4 p-6">
          <h2 id="earn-intro" className="text-lg font-extrabold">
            Let part of your money earn
          </h2>
          <p className="text-muted-foreground">
            Money in your Earning pocket is lent through <b className="text-foreground">{status.vault.name}</b>, a Morpho vault on Arc vetted by
            Circle, using Arc Earn Kit. It earns about <b className="text-foreground">{pct(status.vault.apy)}</b> a year right now. The rate is
            variable and not guaranteed.
          </p>
          <p className="text-muted-foreground">
            Move money in by hand, or set an automatic split to send part of what you receive here. Move it back to your spendable balance
            whenever you like, with your PIN. No Splits fee either way.
          </p>
          <Button className="w-full" busy={busy} onClick={() => void turnOn()}>
            Turn on my Earning pocket
          </Button>
        </section>
      ) : (
        <>
          <section aria-label="Earning pocket balance" className="surface p-6">
            <p className="text-sm text-muted-foreground">In your Earning pocket</p>
            <p className="figure mt-1 text-figure-lg leading-none">≈ ${cents(status.pocket.total)}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Earning now</dt>
                <dd className="font-semibold tabular-nums">≈ ${cents(status.pocket.invested)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rate (variable)</dt>
                <dd className="font-semibold">{pct(status.vault.apy)} a year</dd>
              </div>
              {status.pocket.idle !== "0.00" && (
                <div>
                  <dt className="text-muted-foreground">Going in shortly</dt>
                  <dd className="font-semibold tabular-nums">${cents(status.pocket.idle)}</dd>
                </div>
              )}
              {status.pocket.earned && status.pocket.earned !== "0.00" && (
                <div>
                  <dt className="text-muted-foreground">Earned so far</dt>
                  <dd className="font-semibold tabular-nums">≈ ${cents(status.pocket.earned)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Lent through {status.vault.name} on Arc with Arc Earn Kit. Amounts are approximate because vault shares round.
            </p>
          </section>

          <form onSubmit={(e) => void start(e)} className="surface space-y-4 p-6">
            <Segmented
              kind="radio"
              label="Direction"
              options={[
                { value: "in", label: <><ArrowDownToLine className="h-4 w-4" aria-hidden="true" /> Move in</> },
                { value: "out", label: <><ArrowUpFromLine className="h-4 w-4" aria-hidden="true" /> Move out</> },
              ]}
              value={kind}
              onChange={setKind}
            />
            <Field label="Amount (USDC)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            <Button type="submit" className="w-full" busy={busy} disabled={!amount.trim()}>
              {kind === "in" ? "Move to my Earning pocket" : "Move to my spendable balance"}
            </Button>
          </form>

          {moves.length > 0 && (
            <section aria-labelledby="moves-heading" className="surface p-6">
              <h2 id="moves-heading" className="font-bold">
                Recent moves
              </h2>
              <ul className="mt-3 divide-y divide-border">
                {moves.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span>
                      {LABEL[m.kind]}{" "}
                      <span className="text-muted-foreground">
                        · {m.status === "done" ? "done" : m.status === "failed" ? (m.error ?? "didn't go through") : "under way"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 font-semibold tabular-nums">
                      ${nearestCents(m.amount)}
                      {m.txUrl && (
                        <a href={m.txUrl} target="_blank" rel="noreferrer" aria-label="See it on the Arc explorer" className="-my-3 -mr-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        actionId={pending?.actionId ?? null}
        title={pending?.kind === "out" ? "Move to your spendable balance" : "Move to your Earning pocket"}
        hasPasskey={me.user.hasPasskey}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      >
        <p className="figure text-2xl">${pending?.amount}</p>
        <p className="text-sm text-muted-foreground">
          {pending?.kind === "out"
            ? "From your Earning pocket to your spendable balance. No Splits fee."
            : "From your spendable balance into your Earning pocket. No Splits fee."}
        </p>
      </ConfirmDialog>
    </div>
  );
}
