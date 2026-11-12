"use client";

import { ArrowRight, Check, Copy, FileSpreadsheet, PieChart, Send, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { NEAR } from "@/lib/near/config";
import { formatNear, formatUnits } from "@/lib/near/payment";
import { getAccount, getSplit, spendable, tokenBalance, type SavedSplit } from "@/lib/near/rpc";
import { SharesList } from "./split-flow";
import { useNearWallet } from "./wallet";

type Snapshot = { usdc: bigint | null; near: bigint | null; split: SavedSplit | null };

const ACTIONS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  { href: "/near/split", title: "Auto-split my income", text: "Save how payments to you divide into tax, savings and spending", icon: PieChart },
  { href: "/near/send", title: "Pay a split", text: "One payment to several people, a purpose on every part", icon: Send },
  { href: "/near/payroll", title: "Payroll from a CSV", text: "Upload people and amounts, approve once, export what landed", icon: FileSpreadsheet },
  { href: "/near/group", title: "Group fund", text: "A flat or a trip votes once on how shared money divides", icon: Users },
];

export function Overview() {
  const { ready, accountId, signIn } = useNearWallet();
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!accountId) return setSnap(null);
    const ctl = new AbortController();
    void Promise.all([
      tokenBalance(accountId, ctl.signal).catch(() => null),
      getAccount(accountId, ctl.signal).then((a) => (a ? spendable(a) : null)).catch(() => null),
      getSplit(accountId, ctl.signal).catch(() => null),
    ]).then(([usdc, near, split]) => !ctl.signal.aborted && setSnap({ usdc, near, split }));
    return () => ctl.abort();
  }, [accountId]);

  const payLink = accountId && typeof window !== "undefined" ? `${window.location.origin}/near/pay/${accountId}` : null;

  return (
    <div className="enter space-y-8">
      <header>
        <h1 className="display-face text-3xl leading-tight font-bold sm:text-4xl">Overview</h1>
        <p className="mt-2 text-muted-foreground">
          {accountId ? (
            <>
              Signed in as <span className="font-mono text-ui text-foreground">{accountId}</span> on NEAR {NEAR.network}
            </>
          ) : (
            "Your split, your pay link and what you can do from here"
          )}
        </p>
      </header>

      {!accountId ? (
        <section className="relative overflow-hidden rounded-2xl bg-primary-fill p-6 text-white sm:p-8">
          <div aria-hidden="true" className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-purpose-1/50 blur-[90px]" />
          <div className="relative max-w-lg">
            <h2 className="text-xl font-semibold">Connect a NEAR wallet to start</h2>
            <p className="mt-2 text-white/80">Your saved split lives on your own account. Any NEAR wallet on {NEAR.network} works, and nothing moves without your approval.</p>
            <button
              type="button"
              disabled={!ready}
              onClick={() => void signIn().catch(() => undefined)}
              className="mt-6 inline-flex min-h-12 items-center rounded-full bg-white px-6 font-semibold text-primary-fill transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-fill focus-visible:outline-none disabled:opacity-60"
            >
              Connect NEAR wallet
            </button>
          </div>
        </section>
      ) : (
        <section aria-label="Balances" className="grid gap-4 sm:grid-cols-2">
          <Stat label={`${NEAR.tokenSymbol} balance`} value={snap?.usdc == null ? null : formatUnits(snap.usdc)} unit={NEAR.tokenSymbol} />
          <Stat label="NEAR free for gas" value={snap?.near == null ? null : formatNear(snap.near)} unit="NEAR" />
        </section>
      )}

      {accountId && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section aria-labelledby="split-title" className="surface rounded-2xl p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 id="split-title" className="text-lg font-semibold">
                Your split
              </h2>
              <Link href="/near/split" className="text-sm font-medium text-primary-text underline-offset-4 hover:underline">
                {snap?.split ? "Change it" : "Set it up"}
              </Link>
            </div>
            {snap === null ? (
              <p className="mt-3 text-sm text-muted-foreground">Reading it from NEAR…</p>
            ) : snap.split ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Version {snap.split.version}. Every payment sent to you through Splits divides like this when it arrives.</p>
                <SharesList shares={snap.split.shares} />
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No saved split yet, so money sent to you arrives whole. Save one to auto-split your income into tax, savings and spending.</p>
            )}
          </section>

          <section aria-labelledby="link-title" className="surface h-fit rounded-2xl p-6 sm:p-7">
            <h2 id="link-title" className="text-lg font-semibold">
              Your pay link
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {snap?.split ? "Whoever pays you through it, the money arrives divided." : "It works once you save a split."}
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
          {ACTIONS.map(({ href, title, text, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="surface group flex h-full flex-col rounded-2xl p-5 transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
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

function Stat({ label, value, unit }: { label: string; value: string | null; unit: string }) {
  return (
    <div className="surface rounded-2xl p-5 sm:p-6">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="figure mt-2 text-figure tabular-nums">
        {value ?? <span className="text-muted-foreground">…</span>} {value && <span className="text-base font-semibold text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}
