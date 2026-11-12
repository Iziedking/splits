"use client";

import Link from "next/link";
import * as React from "react";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Button } from "@/components/ui/button";
import { Notice, inputClass } from "@/components/ui/field";
import type { Share } from "@/lib/near/instruction";
import { NEAR, txUrl } from "@/lib/near/config";
import { divideByShares, formatUnits, splitsEvents } from "@/lib/near/payment";
import { finalTx, getSplit, type SavedSplit } from "@/lib/near/rpc";
import { cn } from "@/lib/utils";
import { AccountName, SplitBar } from "./split-card";
import { useNearWallet } from "./wallet";

/** The lead example, in the words of the track's own idea. */
export const LEAD_EXAMPLE = (me: string) => `Auto-split my income: 30% to tax.${me} for tax, 20% to savings.${me} for savings, the rest stays for spending`;

/** The lead example as a split, shown before anyone connects. Example names, never signed. */
const EXAMPLE_SHARES: Share[] = [
  { account_id: "tax.you.testnet", bps: 3000, purpose: "tax" },
  { account_id: "savings.you.testnet", bps: 2000, purpose: "savings" },
  { account_id: "you.testnet", bps: 5000, purpose: "spending" },
];

/** Storage set_split may need; the router returns what it does not use. */
const SET_SPLIT_DEPOSIT = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

export function SplitFlow() {
  const { accountId, signIn, send } = useNearWallet();
  const [saved, setSaved] = React.useState<SavedSplit | null | undefined>(undefined);
  const [text, setText] = React.useState("");
  const [draft, setDraft] = React.useState<{
    shares: Share[];
    notes: string[];
    by: string;
  } | null>(null);
  const [busy, setBusy] = React.useState<null | "reading" | "signing">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savedTx, setSavedTx] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!accountId) return;
    setSaved(await getSplit(accountId).catch(() => null));
  }, [accountId]);

  React.useEffect(() => {
    void load();
    if (accountId) setText((t) => t || LEAD_EXAMPLE(accountId));
  }, [accountId, load]);

  if (!accountId) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="surface h-fit rounded-2xl p-6 sm:p-7">
          <h2 className="text-lg font-semibold">Connect your NEAR wallet</h2>
          <p className="mt-2 text-muted-foreground">Your saved split lives on your own account. Connect to see it or set one.</p>
          <Button className="mt-5" onClick={() => void signIn()}>
            Connect NEAR wallet
          </Button>
        </div>
        <section aria-labelledby="example-title" className="surface rounded-2xl p-6 sm:p-7">
          <h2 id="example-title" className="text-lg font-semibold">
            What you&apos;ll save
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">You write &ldquo;{LEAD_EXAMPLE("you.testnet")}&rdquo;. Splits turns it into this, and every payment of 100.00 sent to you lands like so:</p>
          <SharesList shares={EXAMPLE_SHARES} />
        </section>
      </div>
    );
  }

  async function onRead() {
    setError(null);
    setDraft(null);
    setBusy("reading");
    try {
      const res = await fetch("/api/near/instruction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, me: accountId }),
      });
      const body = (await res.json()) as {
        shares?: Share[];
        notes?: string[];
        by?: string;
        error?: string;
      };
      if (!res.ok || !body.shares) throw new Error(body.error ?? "Could not read that instruction");
      setDraft({
        shares: body.shares,
        notes: body.notes ?? [],
        by: body.by ?? "rules",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that instruction");
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (!draft) return;
    setError(null);
    setBusy("signing");
    try {
      const hash = await send({
        receiverId: NEAR.router,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "set_split",
              args: { shares: draft.shares },
              gas: (30n * 10n ** 12n).toString(),
              deposit: SET_SPLIT_DEPOSIT.toString(),
            },
          },
        ],
      });
      const tx = await finalTx(hash, accountId!);
      const ok = splitsEvents(tx, NEAR.router).some((e) => e.event === "split_saved" && e.data.owner === accountId);
      if (!ok) throw new Error("Your rule wasn't saved. Please try again.");
      setSavedTx(hash);
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet did not save the split");
    } finally {
      setBusy(null);
    }
  }

  const payLink = typeof window !== "undefined" ? `${window.location.origin}/near/pay/${accountId}` : `/near/pay/${accountId}`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="surface rounded-2xl p-6 sm:p-7" aria-labelledby="now-title">
        <h2 id="now-title" className="text-lg font-semibold">
          Your split now
        </h2>
        {saved === undefined ? (
          <p className="mt-2 text-sm text-muted-foreground">Reading it from NEAR…</p>
        ) : saved === null ? (
          <p className="mt-2 text-sm text-muted-foreground">You have no saved split. Money sent to you arrives whole.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">Version {saved.version}. Every payment sent to you through Splits is divided like this, on chain, the moment it arrives.</p>
            <SharesList shares={saved.shares} />
            <div className="mt-4 rounded-xl bg-white/70 p-4 ring-1 ring-white">
              <p className="text-sm font-semibold">Your pay link</p>
              <p className="mt-1 text-sm break-all text-primary-text">{payLink}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(payLink)}>
                  Copy link
                </Button>
                <Link className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-primary-text underline" href={`/near/pay/${accountId}`}>
                  Open it
                </Link>
              </div>
            </div>
          </>
        )}
        {savedTx && (
          <Notice tone="success" className="mt-4">
            Saved on NEAR.{" "}
            <a className="underline" href={txUrl(savedTx)} target="_blank" rel="noreferrer">
              See the transaction
            </a>
          </Notice>
        )}
      </section>

      <section className="surface rounded-2xl p-6 sm:p-7" aria-labelledby="set-title">
        <h2 id="set-title" className="text-lg font-semibold">
          Say how to split your income
        </h2>
        <label htmlFor="instruction" className="mt-2 block text-sm text-muted-foreground">
          In plain words: who gets what share, and what it&apos;s for. Name each NEAR account. Whatever you don&apos;t give away stays with you.
        </label>
        <textarea id="instruction" className={cn(inputClass, "mt-3 min-h-32 py-3")} value={text} onChange={(e) => (setText(e.target.value), setDraft(null))} />
        <Button className="mt-3 w-full" variant="secondary" busy={busy === "reading"} disabled={!text.trim()} onClick={() => void onRead()}>
          Turn it into a split
        </Button>

        {draft && (
          <div className="mt-5">
            <p className="text-sm font-semibold">Check it before you save it</p>
            <SharesList shares={draft.shares} />
            {draft.notes.map((n) => (
              <Notice key={n} className="mt-2">
                {n}
              </Notice>
            ))}
            <p className="mt-3 text-xs text-muted-foreground">
              {draft.by === "near-ai" ? "Read by NEAR AI, then checked by Splits: " : "Read by Splits' rules: "}
              only accounts and percentages you wrote can appear. Saving asks your wallet to approve it, with a small 0.01 NEAR deposit; whatever isn&apos;t needed comes back.
            </p>
            <Button className="mt-3 w-full" busy={busy === "signing"} disabled={draft.shares.length === 0} onClick={() => void onSave()}>
              Save this split
            </Button>
          </div>
        )}
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
      </section>
    </div>
  );
}

export function SharesList({ shares, example = 100_000_000n }: { shares: Share[]; example?: bigint }) {
  const parts = divideByShares(example, shares);
  return (
    <div className="mt-4 rounded-xl bg-white/70 p-4 ring-1 ring-white">
      <SplitBar weights={shares.map((s) => s.bps)} />
      <ul className="mt-3 divide-y divide-foreground/8">
        {shares.map((s, i) => (
          <li key={s.account_id} className="flex items-center gap-3 py-3 last:pb-0">
            <PurposeDot index={i} />
            <div className="min-w-0 flex-1">
              <AccountName id={s.account_id} className="font-medium" />
              <p className="text-xs text-muted-foreground first-letter:uppercase">{s.purpose}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">{(s.bps / 100).toString()}%</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatUnits(parts[i]!)} of {formatUnits(example)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
