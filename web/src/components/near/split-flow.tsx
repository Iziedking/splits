"use client";

import Link from "next/link";
import * as React from "react";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Button } from "@/components/ui/button";
import { Notice, inputClass } from "@/components/ui/field";
import type { Share } from "@/lib/near/instruction";
import { NEAR, txUrl } from "@/lib/near/config";
import { BPS_TOTAL, divideByShares, formatUnits, splitsEvents } from "@/lib/near/payment";
import { finalTx, getSplit, type SavedSplit } from "@/lib/near/rpc";
import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { useNearWallet } from "./wallet";

/** The lead example, in the words of the track's own idea. */
export const LEAD_EXAMPLE = (me: string) =>
  `Auto-split my income: 30% to tax.${me} for tax, 20% to savings.${me} for savings, the rest stays for spending`;

/** Storage set_split may need; the router returns what it does not use. */
const SET_SPLIT_DEPOSIT = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

export function SplitFlow() {
  const { accountId, signIn, send } = useNearWallet();
  const [saved, setSaved] = React.useState<SavedSplit | null | undefined>(undefined);
  const [text, setText] = React.useState("");
  const [draft, setDraft] = React.useState<{ shares: Share[]; notes: string[]; by: string } | null>(null);
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
      <div className="surface rounded-lg p-6">
        <h2 className="text-xl font-bold">Connect your NEAR wallet</h2>
        <p className="mt-2 text-muted-foreground">Your saved split lives on your own account. Connect to see it or set one.</p>
        <Button className="mt-4" onClick={() => void signIn()}>
          Connect NEAR wallet
        </Button>
      </div>
    );
  }

  async function onRead() {
    setError(null);
    setDraft(null);
    setBusy("reading");
    try {
      const res = await fetch("/api/near/instruction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, me: accountId }) });
      const body = (await res.json()) as { shares?: Share[]; notes?: string[]; by?: string; error?: string };
      if (!res.ok || !body.shares) throw new Error(body.error ?? "Could not read that instruction");
      setDraft({ shares: body.shares, notes: body.notes ?? [], by: body.by ?? "rules" });
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
            params: { methodName: "set_split", args: { shares: draft.shares }, gas: (30n * 10n ** 12n).toString(), deposit: SET_SPLIT_DEPOSIT.toString() },
          },
        ],
      });
      const tx = await finalTx(hash, accountId!);
      const ok = splitsEvents(tx, NEAR.router).some((e) => e.event === "split_saved" && e.data.owner === accountId);
      if (!ok) throw new Error("The router did not record the split. Check the transaction.");
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
      <section className="surface rounded-lg p-5 sm:p-6" aria-labelledby="now-title">
        <h2 id="now-title" className="text-xl font-bold">
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
            <div className="mt-4 rounded-md bg-white/70 p-3 ring-1 ring-white">
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

      <section className="surface rounded-lg p-5 sm:p-6" aria-labelledby="set-title">
        <h2 id="set-title" className="text-xl font-bold">
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
              only accounts and percentages you wrote can appear, and the rest is worked out by code. Saving asks your wallet to approve it, with 0.01 NEAR for storage; the router returns what it doesn&apos;t use.
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
    <>
      <ul className="mt-3 space-y-2">
        {shares.map((s, i) => (
          <li key={s.account_id} className="flex items-center gap-3 rounded-md bg-white/60 px-3 py-2 ring-1 ring-white">
            <PurposeDot index={i} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{s.account_id}</p>
              <p className="text-xs text-muted-foreground">{s.purpose}</p>
            </div>
            <div className="text-right">
              <p className="figure text-sm">{(s.bps / 100).toString()}%</p>
              <p className="text-xs text-muted-foreground">{formatUnits(parts[i]!)} of 100</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full" aria-hidden="true">
        {shares.map((s, i) => (
          <span key={s.account_id} className="h-full" style={{ width: `${(s.bps / BPS_TOTAL) * 100}%`, background: purposeFill(i) }} />
        ))}
      </div>
    </>
  );
}
