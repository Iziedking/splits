"use client";

import { ArrowRight, Check, Copy, FileSpreadsheet, Gift, LogOut, PieChart, ReceiptText, Send, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { NEAR } from "@/lib/near/config";
import { formatDollars, formatNear } from "@/lib/near/payment";
import { getAccount, getSplit, spendable, tokenBalance, type SavedSplit } from "@/lib/near/rpc";
import { SharesList } from "./split-flow";
import { useNearWallet } from "./wallet";

type Snapshot = { usdc: bigint | null; near: bigint | null; split: SavedSplit | null };

const ACTIONS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  { href: "/near/split", title: "Auto-split my income", text: "Save how payments to you divide into tax, savings and spending", icon: PieChart },
  { href: "/near/send", title: "Pay people", text: "One payment to several people, a purpose on every part", icon: Send },
  { href: "/near/bill", title: "Split a bill", text: "You paid for dinner; friends each pay their part back from one link", icon: ReceiptText },
  { href: "/near/payroll", title: "Payroll", text: "Upload a spreadsheet of people and amounts, approve once", icon: FileSpreadsheet },
  { href: "/near/group", title: "Group fund", text: "Flatmates or a trip vote once on how shared money divides", icon: Users },
  { href: "/near/button", title: "Checkout button", text: "A Pay with Splits button for your shop: every sale lands divided", icon: ShoppingBag },
];

export function Overview() {
  const { ready, accountId, kind, email, testMoneyTaken, tookTestMoney, signIn, signOut } = useNearWallet();
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    if (!accountId) return setSnap(null);
    const ctl = new AbortController();
    void Promise.all([
      tokenBalance(accountId, ctl.signal).catch(() => null),
      getAccount(accountId, ctl.signal).then((a) => (a ? spendable(a) : null)).catch(() => null),
      getSplit(accountId, ctl.signal).catch(() => null),
    ]).then(([usdc, near, split]) => !ctl.signal.aborted && setSnap({ usdc, near, split }));
    return () => ctl.abort();
  }, [accountId, refresh]);

  const payLink = accountId && typeof window !== "undefined" ? `${window.location.origin}/near/pay/${accountId}` : null;

  return (
    <div className="enter space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display-face text-3xl leading-tight font-bold sm:text-4xl">{accountId ? "Welcome back" : "Home"}</h1>
          <p className="mt-2 text-muted-foreground">
            {accountId ? (
              <>
                Signed in as{" "}
                {email ? (
                  <span className="text-foreground">{email}</span>
                ) : (
                  <span className="font-mono text-ui break-all text-foreground">{accountId}</span>
                )}
              </>
            ) : (
              "Your rule, your pay link and what you can do from here"
            )}
          </p>
        </div>
        {accountId && (
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:hidden"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Sign out
          </button>
        )}
      </header>

      {!accountId ? (
        <section className="relative overflow-hidden rounded-2xl bg-primary-fill p-6 text-white sm:p-8">
          <div aria-hidden="true" className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-purpose-1/50 blur-[90px]" />
          <div className="relative max-w-lg">
            <h2 className="text-xl font-semibold">Sign in to start</h2>
            <p className="mt-2 text-white/80">Use your email. Your account is ready in seconds, and Splits covers every fee.</p>
            <button
              type="button"
              disabled={!ready}
              onClick={() => void signIn().catch(() => undefined)}
              className="mt-6 inline-flex min-h-12 items-center rounded-full bg-white px-6 font-semibold text-primary-fill transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-fill focus-visible:outline-none disabled:opacity-60"
            >
              Sign in
            </button>
          </div>
        </section>
      ) : (
        <>
          <section aria-label="Balance" className={kind === "email" ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}>
            <Stat label="Your balance" value={snap?.usdc == null ? null : formatDollars(snap.usdc)} unit="" note={`Held as ${NEAR.tokenSymbol}, a digital dollar.`} />
            {kind !== "email" && <Stat label="NEAR for fees" value={snap?.near == null ? null : formatNear(snap.near)} unit="NEAR" />}
          </section>
          {kind === "email" && !testMoneyTaken && <TestMoney onDone={() => (tookTestMoney(), setRefresh((n) => n + 1))} />}
        </>
      )}

      {accountId && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section aria-labelledby="split-title" className="surface rounded-2xl p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 id="split-title" className="text-lg font-semibold">
                Your rule
              </h2>
              <Link href="/near/split" className="text-sm font-medium text-primary-text underline-offset-4 hover:underline">
                {snap?.split ? "Change it" : "Set it up"}
              </Link>
            </div>
            {snap === null ? (
              <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
            ) : snap.split ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Every payment sent to you through Splits divides like this when it arrives.</p>
                <SharesList shares={snap.split.shares} />
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No rule yet, so money sent to you arrives whole. Set one to auto-split your income into tax, savings and spending.</p>
            )}
          </section>

          <section aria-labelledby="link-title" className="surface h-fit rounded-2xl p-6 sm:p-7">
            <h2 id="link-title" className="text-lg font-semibold">
              Your pay link
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {snap?.split ? "Whoever pays you through it, the money arrives divided." : "It works once you set your rule."}
            </p>
            {payLink && <p className="mt-4 rounded-lg bg-white/70 px-3 py-2.5 font-mono text-micro break-all ring-1 ring-white">{payLink}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!payLink}
                onClick={() => {
                  if (!payLink) return;
                  void navigator.clipboard?.writeText(payLink).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              {accountId && (
                <Link className="inline-flex min-h-9 items-center px-2 text-sm font-medium text-primary-text underline-offset-4 hover:underline" href={`/near/pay/${accountId}`}>
                  Open it
                </Link>
              )}
            </div>
          </section>
        </div>
      )}

      <section aria-labelledby="do-title">
        <h2 id="do-title" className="text-lg font-semibold">
          What you can do
        </h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {ACTIONS.map(({ href, title, text, icon: Icon }, i) => (
            <li key={href} className="enter" style={{ animationDelay: `${80 + i * 50}ms` }}>
              <Link
                href={href}
                className="surface group flex h-full flex-col rounded-2xl p-5 transition-[transform,background-color] duration-150 ease-out hover:-translate-y-0.5 hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:translate-y-0 active:scale-[0.98] motion-reduce:transform-none"
              >
                <span className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-fill/10 text-primary-text">
                    <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="mt-4 font-semibold">{title}</span>
                <span className="mt-1 text-sm text-muted-foreground">{text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, unit, note }: { label: string; value: string | null; unit: string; note?: string }) {
  return (
    <div className="surface rounded-2xl p-5 sm:p-6">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="figure mt-2 text-figure tabular-nums">
        {value ?? <span className="text-muted-foreground">…</span>} {value && unit && <span className="text-base font-semibold text-muted-foreground">{unit}</span>}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** A new email account has nothing to pay with, so it can take a little test money once. */
function TestMoney({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/near/test-money", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? "That did not work. Try again.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="test-money-title" className="surface flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:p-6">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purpose-4/40 text-foreground">
        <Gift className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="test-money-title" className="font-semibold">
          Add $5.00 of test money
        </h2>
        <p className="text-sm text-muted-foreground">Test money has no value. It is here so you can try paying people right away.</p>
        {error && (
          <Notice tone="error" className="mt-2">
            {error}
          </Notice>
        )}
      </div>
      <Button busy={busy} onClick={() => void add()}>
        Add test money
      </Button>
    </section>
  );
}
