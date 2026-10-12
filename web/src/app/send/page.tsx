"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { BackLink } from "@/components/app/back-link";
import { Backdrop } from "@/components/app/backdrop";
import { FeeLines } from "@/components/app/fee-lines";
import { PayoutComposer } from "@/components/app/payout-composer";
import { ReviewTable } from "@/components/app/review-table";
import { VisitorHeader } from "@/components/app/visitor-header";
import { VisitorLimit } from "@/components/app/visitor-limit";
import { WalletSteps } from "@/components/app/wallet-steps";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, ApiError, errorMessage, type ContractLeg, type Me, type PayoutCheck, type VisitorConfig, type VisitorPaymentView } from "@/lib/api";
import { loadWalletBridge } from "@/lib/wallet/bridge";
import { cn } from "@/lib/utils";

type Prepared = { payment: VisitorPaymentView; legs: ContractLeg[]; balance: string; allowance: string };

/** Pay without an account (spec §1): check the list, connect a wallet, sign twice. */
export default function VisitorPay() {
  const router = useRouter();
  const [config, setConfig] = React.useState<VisitorConfig | null>(null);
  const [mode, setMode] = React.useState<"one" | "many">("one");
  const [check, setCheck] = React.useState<PayoutCheck | null>(null);
  const [email, setEmail] = React.useState("");
  const [prepared, setPrepared] = React.useState<Prepared | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; limit: boolean } | null>(null);
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

  React.useEffect(() => {
    api<Me>("/api/me").then(() => router.replace("/pay")).catch(() => undefined);
    api<VisitorConfig>("/api/visitor/config").then(setConfig).catch((err) => setError({ text: errorMessage(err), limit: false }));
  }, [router]);

  function onChecked(next: PayoutCheck | null) {
    setCheck(next);
    setPrepared(null);
    setError(null);
  }

  async function connectAndReserve() {
    if (!check?.draft || !config || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      const payer = await (await loadWalletBridge(config, projectId)).connect();
      setPrepared(
        await api<Prepared>("/api/visitor/prepare", {
          body: { draftId: check.draft.id, draftHash: check.draft.hash, payer, email: email.trim() || null },
        }),
      );
    } catch (err) {
      if (err instanceof Error && err.message === "closed") return;
      setError({ text: errorMessage(err), limit: err instanceof ApiError && err.code === "SEND_LIMIT" });
      if (err instanceof ApiError && (err.code === "LIST_CHANGED" || err.code === "LIST_ALREADY_PAID")) setCheck(null);
    } finally {
      setBusy(false);
    }
  }

  async function sent(hash: `0x${string}`) {
    const token = prepared!.payment.token!;
    // The link works even if this report never arrives: the server finds the payment on Arc.
    router.push(`/p/${token}`);
    await api("/api/visitor/submit", { body: { token, txHash: hash } }).catch(() => undefined);
  }

  return (
    <div className="min-h-screen">
      <Backdrop />
      <VisitorHeader config={config} />
      <main className="enter mx-auto max-w-md space-y-6 px-5 pt-4 pb-16">
        <div>
          <BackLink />
          <h1 className="mt-2 text-[2rem] leading-tight font-extrabold">Pay from your wallet</h1>
          <p className="mt-2 text-muted-foreground">No account needed. Pay anyone by email or Arc address, in one transaction.</p>
        </div>

        <div role="tablist" aria-label="Who gets paid" className="grid grid-cols-2 rounded-full bg-white/60 p-1 ring-1 ring-white">
          {(["one", "many"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                onChecked(null);
              }}
              className={cn(
                "min-h-11 rounded-full text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "one" ? "One person" : "Many people"}
            </button>
          ))}
        </div>

        <div className="surface p-5">
          <PayoutComposer key={mode} mode={mode} initialLabel="payment" onChecked={onChecked} checkPath="/api/visitor/check" />
        </div>

        {check && <ReviewTable check={check} />}

        {check?.ready && !prepared && (
          <div className="surface space-y-4 p-5">
            <Field label="Email for your receipt (optional)" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {check.fee && check.charge && <FeeLines fee={check.fee} percent={check.feePercent} total={check.charge} />}
            {!config?.live ? (
              <Notice>Wallet payments need a live server. This one is a preview.</Notice>
            ) : !projectId ? (
              <Notice>Wallet payments aren&apos;t set up on this server yet.</Notice>
            ) : (
              <Button className="w-full" busy={busy} onClick={() => void connectAndReserve()}>
                Pay ${check.charge ?? check.total} from your wallet
              </Button>
            )}
          </div>
        )}

        {prepared && config && (
          <div className="surface p-5">
            <WalletSteps config={config} prepared={prepared} onSent={(h) => void sent(h)} />
          </div>
        )}

        {error && (error.limit ? <VisitorLimit message={error.text} signedIn={false} /> : <Notice tone="error">{error.text}</Notice>)}
      </main>
    </div>
  );
}
