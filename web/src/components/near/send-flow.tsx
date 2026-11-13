"use client";

import * as React from "react";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Field, Notice, inputClass } from "@/components/ui/field";
import { NEAR } from "@/lib/near/config";
import {
  buildPayTx,
  checkList,
  formatNear,
  nearNeededForGas,
  newRef,
  STORAGE_DEPOSIT,
  type Leg,
  type Line,
  formatDollars,
  type Problem,
} from "@/lib/near/payment";
import { rememberName } from "@/lib/near/names";
import { getAccount, isRegistered, spendable, tokenBalance } from "@/lib/near/rpc";
import { cn } from "@/lib/utils";
import { PaymentResult, returnedHash, savePending, takePending, useVerify, type Pending } from "./result";
import { useNearWallet } from "./wallet";
import { AccountName, SplitBar } from "./split-card";

const EMPTY: Line = { account: "", amount: "", purpose: "" };

/** Three real testnet accounts, already registered with testnet USDC, for a first try. */
export const SAMPLE: Line[] = [
  { account: "tax.kingizie.testnet", amount: "0.30", purpose: "tax" },
  { account: "savings.kingizie.testnet", amount: "0.20", purpose: "savings" },
  { account: "mum.kingizie.testnet", amount: "0.50", purpose: "upkeep for mum" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lines that name an email get that person's Splits account, made now if they are new (they find the
 * money when they sign in with that email). Returns the lines with accounts, or the problems.
 */
async function withAccounts(lines: Line[]): Promise<{ lines: Line[]; problems: Problem[] }> {
  const problems: Problem[] = [];
  const out = await Promise.all(
    lines.map(async (l, i) => {
      const email = l.account.trim();
      if (!EMAIL.test(email)) return l;
      try {
        const res = await fetch("/api/near/recipient", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
        const body = (await res.json().catch(() => ({}))) as { accountId?: string; error?: { message?: string } };
        if (!res.ok || !body.accountId) throw new Error(body.error?.message ?? "That email could not be set up. Try again.");
        rememberName(body.accountId, email.toLowerCase());
        return { ...l, account: body.accountId };
      } catch (e) {
        problems.push({ line: i + 1, message: e instanceof Error ? e.message : "That email could not be set up. Try again." });
        return l;
      }
    }),
  );
  return { lines: out, problems };
}

type Review = { legs: Leg[]; total: bigint; unregistered: string[]; balance: bigint; nearFree: bigint; blockers: string[] };

export function SendFlow({ initial }: { initial?: Line[] }) {
  const { accountId, kind, signIn, send } = useNearWallet();
  const [mode, setMode] = React.useState<"each" | "equal">("each");
  const [pot, setPot] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>(initial?.length ? initial : [EMPTY, EMPTY]);
  const [problems, setProblems] = React.useState<Problem[]>([]);
  const [review, setReview] = React.useState<Review | null>(null);
  const [busy, setBusy] = React.useState<null | "checking" | "signing">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [hash, setHash] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const check = useVerify(hash, pending);

  // A wallet that redirected away comes back here with the hash.
  React.useEffect(() => {
    const h = returnedHash();
    const p = h ? takePending() : null;
    if (h && p) {
      setPending(p);
      setHash(h);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const update = (i: number, patch: Partial<Line>) => {
    setReview(null);
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  async function onReview() {
    setError(null);
    setReview(null);
    const byEmail = lines.map((l, i) => (EMAIL.test(l.account.trim()) ? i : -1)).filter((i) => i >= 0);
    if (byEmail.length && kind !== "email") {
      setProblems(byEmail.map((i) => ({ line: i + 1, message: "Paying someone by their email needs you signed in with your email." })));
      return;
    }
    setBusy("checking");
    try {
      const named = byEmail.length ? await withAccounts(lines) : { lines, problems: [] };
      if (named.problems.length) {
        setProblems(named.problems);
        return;
      }
      const r = checkList(named.lines, { me: accountId, mode, pot });
      setProblems(r.problems);
      if (r.problems.length) return;
      const accounts = await Promise.all(r.legs.map((l) => getAccount(l.account_id)));
      const missing = r.legs.filter((_, i) => !accounts[i]).map((l) => l.account_id);
      if (missing.length) {
        setProblems(missing.map((m) => ({ line: named.lines.findIndex((l) => l.account.trim().toLowerCase().replace(/^@/, "") === m) + 1, message: `There is no Splits account called ${m}. Check it, or pay them by their email.` })));
        return;
      }
      const registered = await Promise.all(r.legs.map((l) => isRegistered(l.account_id)));
      const unregistered = r.legs.filter((_, i) => !registered[i]).map((l) => l.account_id);
      const blockers: string[] = [];
      let balance = 0n;
      let nearFree = 0n;
      if (accountId) {
        const [b, me] = await Promise.all([tokenBalance(accountId).catch(() => 0n), getAccount(accountId)]);
        balance = b;
        nearFree = me ? spendable(me) : 0n;
        if (b < r.total) blockers.push(`You have ${formatDollars(b)}. This payment needs ${formatDollars(r.total)}.`);
        const nearNeeded = nearNeededForGas(r.legs.length) + STORAGE_DEPOSIT * BigInt(unregistered.length);
        if (kind !== "email" && nearFree < nearNeeded) blockers.push(`Your wallet needs about ${formatNear(nearNeeded)} NEAR free for gas and registrations; it has ${formatNear(nearFree)}. Most of the gas comes back after the payment.`);
      }
      setReview({ legs: r.legs, total: r.total, unregistered, balance, nearFree, blockers });
    } catch (e) {
      setError(e instanceof Error ? `Could not check the list: ${e.message}` : "Could not check the list");
    } finally {
      setBusy(null);
    }
  }

  async function onPay() {
    if (!review || !accountId) return;
    setError(null);
    setBusy("signing");
    const ref = newRef();
    const p: Pending = { payer: accountId, ref, legs: review.legs, total: review.total.toString() };
    savePending(p);
    try {
      const tx = buildPayTx({
        token: NEAR.token,
        router: NEAR.router,
        total: review.total,
        msg: { ref, legs: review.legs },
        parts: review.legs.length,
        unregistered: review.unregistered,
      });
      const h = await send(tx);
      takePending();
      setPending(p);
      setHash(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The payment did not go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (hash && pending) {
    return (
      <PaymentResult
        hash={hash}
        pending={pending}
        check={check}
        onAgain={() => {
          setHash(null);
          setPending(null);
          setReview(null);
          setLines([EMPTY, EMPTY]);
        }}
      />
    );
  }

  const lineProblem = (i: number) => problems.filter((p) => p.line === i + 1).map((p) => p.message).join(" · ") || null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section aria-labelledby="list-title" className="surface rounded-2xl p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="list-title" className="text-lg font-semibold">
            Who gets what
          </h2>
          <Segmented
            kind="radio"
            label="How to divide"
            options={[
              { value: "each", label: "Amount for each" },
              { value: "equal", label: "Share a total" },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setReview(null);
            }}
          />
        </div>

        {mode === "equal" && (
          <Field className="mt-4" label="Total to share ($)" inputMode="decimal" placeholder="300" value={pot} onChange={(e) => (setPot(e.target.value), setReview(null))} />
        )}

        <ol className="mt-4 space-y-3">
          {lines.map((l, i) => (
            <li key={i} className="rounded-md bg-white/60 p-3 ring-1 ring-white">
              <div className="flex items-center gap-2 pb-2">
                <PurposeDot index={i} />
                <span className="text-sm font-medium text-muted-foreground">Person {i + 1}</span>
                {lines.length > 1 && (
                  <button type="button" className="ml-auto text-sm text-muted-foreground underline" onClick={() => (setLines((ls) => ls.filter((_, j) => j !== i)), setReview(null))}>
                    Remove
                  </button>
                )}
              </div>
              <div className={cn("grid gap-2", mode === "each" ? "sm:grid-cols-[1.4fr_0.7fr_1fr]" : "sm:grid-cols-[1.4fr_1fr]")}>
                <input aria-label={`Person ${i + 1}: email or Splits account`} className={inputClass} placeholder="ada@example.com" inputMode="email" autoCapitalize="none" spellCheck={false} value={l.account} onChange={(e) => update(i, { account: e.target.value })} />
                {mode === "each" && (
                  <input aria-label={`Person ${i + 1}: amount`} className={inputClass} placeholder="0.00" inputMode="decimal" value={l.amount} onChange={(e) => update(i, { amount: e.target.value })} />
                )}
                <input aria-label={`Person ${i + 1}: what it's for`} className={inputClass} placeholder="what it's for" value={l.purpose} onChange={(e) => update(i, { purpose: e.target.value })} />
              </div>
              {lineProblem(i) && <p className="mt-2 text-sm text-destructive">{lineProblem(i)}</p>}
            </li>
          ))}
        </ol>

        <div className="mt-3 flex flex-wrap gap-2">
          {lines.length < 10 && (
            <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, EMPTY])}>
              Add a person
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => (setMode("each"), setLines(SAMPLE), setReview(null))}>
            Fill a sample split
          </Button>
        </div>

        <Describe onFill={(filled, notes) => (setLines(filled.length ? filled : [EMPTY]), setReview(null), setProblems(notes.map((n) => ({ line: null, message: n }))))} me={accountId} />

        {problems.filter((p) => p.line === null).map((p) => (
          <Notice key={p.message} tone="info" className="mt-3">
            {p.message}
          </Notice>
        ))}
      </section>

      <aside aria-labelledby="review-title" className="surface h-fit rounded-2xl p-6 sm:p-7 lg:sticky lg:top-6">
        <h2 id="review-title" className="text-lg font-semibold">
          Review
        </h2>
        {!review ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">Check the list to see exactly what each person gets. Pay anyone by their email: someone new finds the money when they sign in with it.</p>
            <Button className="mt-4 w-full" busy={busy === "checking"} onClick={() => void onReview()}>
              Check the list
            </Button>
          </>
        ) : (
          <>
            <SplitBar className="mt-4" weights={review.legs.map((l) => Number(BigInt(l.amount) / 10_000n) || 1)} />
            <ul className="mt-3 divide-y divide-foreground/8">
              {review.legs.map((l, i) => (
                <li key={l.account_id} className="flex items-start gap-3 py-3">
                  <PurposeDot index={i} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <AccountName id={l.account_id} className="font-medium" />
                    <p className="text-xs text-muted-foreground">{l.purpose}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{formatDollars(BigInt(l.amount))}</p>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t border-foreground/8 pt-3">
              <span className="font-semibold">Total</span>
              <span className="figure text-2xl">
                {formatDollars(review.total)}
              </span>
            </div>
            {review.unregistered.length > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                {review.unregistered.length === 1 ? "One person is" : `${review.unregistered.length} people are`} new to Splits money. {kind === "email" ? "Splits sets them up for free." : `The same approval sets them up for ${formatNear(STORAGE_DEPOSIT)} NEAR each.`}
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              You approve once. If one part can&apos;t be delivered, it comes back to you and the others still arrive. No fees.
            </p>
            {review.blockers.map((b) => (
              <Notice key={b} tone="error" className="mt-3">
                {b}{" "}
                {kind === "email" ? (
                  <a className="underline" href="/near/app">
                    Add test money
                  </a>
                ) : (
                  <a className="underline" href={b.includes("NEAR free") ? NEAR.nearFaucet : NEAR.faucet} target="_blank" rel="noreferrer">
                    Get test {b.includes("NEAR free") ? "NEAR" : NEAR.tokenSymbol}
                  </a>
                )}
              </Notice>
            ))}
            {accountId ? (
              <Button className="mt-4 w-full" busy={busy === "signing"} disabled={review.blockers.length > 0} onClick={() => void onPay()}>
                Pay {formatDollars(review.total)}
              </Button>
            ) : (
              <Button className="mt-4 w-full" onClick={() => void signIn()}>
                Sign in to pay
              </Button>
            )}
            <Button className="mt-2 w-full" variant="ghost" size="sm" onClick={() => setReview(null)}>
              Change the list
            </Button>
          </>
        )}
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
      </aside>
    </div>
  );
}

/** "Describe it, I split it": plain words in, a list to check out. Nothing is paid from here. */
function Describe({ onFill, me }: { onFill: (lines: Line[], notes: string[]) => void; me: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <details className="mt-5 rounded-md bg-white/50 p-3 ring-1 ring-white" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-semibold">Describe it, I split it</summary>
      <label htmlFor="describe" className="mt-3 block text-sm text-muted-foreground">
        Paste a message or write it out, one person per line: their NEAR account, the amount and what it&apos;s for.
      </label>
      <textarea id="describe" className={cn(inputClass, "mt-2 min-h-28 py-3")} placeholder={"ada.testnet 50 for rent\nbo.testnet 20 for food"} value={text} onChange={(e) => setText(e.target.value)} />
      <Button
        size="sm"
        className="mt-2"
        busy={busy}
        disabled={!text.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/near/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, me }) });
            const body = (await res.json()) as { lines?: Line[]; notes?: string[]; error?: string };
            if (!res.ok || !body.lines) throw new Error(body.error ?? "Could not read that");
            onFill(body.lines, body.notes ?? []);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not read that");
          } finally {
            setBusy(false);
          }
        }}
      >
        Fill the list
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">Only accounts and amounts you wrote can appear. You check every line before anything is paid.</p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </details>
  );
}
