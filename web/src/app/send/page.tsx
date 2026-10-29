"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { BackLink } from "@/components/app/back-link";
import { ChainPicker, type ChainOption } from "@/components/app/chain-picker";
import { CrossWalletSteps } from "@/components/app/cross-wallet-steps";
import { Backdrop } from "@/components/app/backdrop";
import { FeeLines } from "@/components/app/fee-lines";
import { PayoutComposer } from "@/components/app/payout-composer";
import { readPrefill, type Prefill } from "@/lib/prefill";
import { ReviewTable } from "@/components/app/review-table";
import { Segmented, tabPanelProps } from "@/components/app/segmented";
import { VisitorHeader } from "@/components/app/visitor-header";
import { VisitorLimit } from "@/components/app/visitor-limit";
import { WalletSteps } from "@/components/app/wallet-steps";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, ApiError, errorMessage, type ContractLeg, type CrossCall, type CrossChainOption, type CrossCost, type Me, type PayoutCheck, type VisitorConfig, type VisitorPaymentView } from "@/lib/api";
import { loadWalletBridge } from "@/lib/wallet/bridge";
import { rememberWallet, toUnits, walletRemembered } from "@/lib/wallet/flow";
import { pickChain, readFunds, type ChainFunds } from "@/lib/wallet/sourceChains";

type Prepared = { payment: VisitorPaymentView; legs: ContractLeg[]; balance: string; allowance: string };
type CrossPrepared = { payment: VisitorPaymentView; cost: CrossCost; call: CrossCall };

/** Arc first, then every chain cross-chain pay is on, as the picker and the balance reader need them. */
function payOptions(config: VisitorConfig): (ChainOption & { source: CrossChainOption })[] {
  const arcName = config.network === "arc" ? "Arc" : "Arc testnet";
  const arc: CrossChainOption = {
    key: "arc",
    name: arcName,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    usdc: config.usdc,
    tokenMessenger: config.router,
    explorerUrl: config.explorerUrl,
    gas: "USDC",
    fast: true,
  };
  return [arc, ...(config.crossPay?.chains ?? [])].map((c) => ({ key: c.key, name: c.name, gas: c.gas, fast: c.fast, source: c }));
}

/** Pay without an account (spec §1): check the list, connect a wallet, sign twice. */
export default function VisitorPay() {
  const router = useRouter();
  const [config, setConfig] = React.useState<VisitorConfig | null>(null);
  const [mode, setMode] = React.useState<"one" | "many">("one");
  const tabs = React.useId();
  const [check, setCheck] = React.useState<PayoutCheck | null>(null);
  const [prepared, setPrepared] = React.useState<Prepared | null>(null);
  const [crossPrepared, setCrossPrepared] = React.useState<CrossPrepared | null>(null);
  const [payer, setPayer] = React.useState<`0x${string}` | null>(null);
  const [funds, setFunds] = React.useState<ChainFunds[] | null>(null);
  const [from, setFrom] = React.useState<string | null>(null);
  /** The wallet connected on this device, restored from the last visit; shown so it's clear who pays. */
  const [wallet, setWallet] = React.useState<`0x${string}` | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; limit: boolean } | null>(null);
  const [prefill, setPrefill] = React.useState<Prefill | null>(null);
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

  React.useEffect(() => {
    // Signed in after all: the pay screen, keeping anything a tag's page filled in.
    api<Me>("/api/me").then(() => router.replace(`/pay${window.location.search}`)).catch(() => undefined);
    const from = readPrefill(window.location.search);
    if (from) {
      setMode("one");
      setPrefill(from);
    }
    api<VisitorConfig>("/api/visitor/config").then(setConfig).catch((err) => setError({ text: errorMessage(err), limit: false }));
  }, [router]);

  // A wallet connected here before comes back on its own, so Pay won't open the wallet sheet again.
  React.useEffect(() => {
    if (!config?.live || !projectId || !walletRemembered(storage())) return;
    loadWalletBridge(config, projectId)
      .then((b) => b.restore())
      .then((account) => (account ? setWallet(account) : rememberWallet(storage(), false)))
      .catch(() => undefined);
  }, [config, projectId]);

  async function switchWallet() {
    if (!config || !projectId) return;
    await (await loadWalletBridge(config, projectId)).disconnect().catch(() => undefined);
    rememberWallet(storage(), false);
    setWallet(null);
    onChecked(check);
  }

  function onChecked(next: PayoutCheck | null) {
    setCheck(next);
    setPrepared(null);
    setCrossPrepared(null);
    setPayer(null);
    setFunds(null);
    setFrom(null);
    setError(null);
  }

  /** What the payer needs where their USDC is: the charge on Arc, plus Circle's fee (about 0.02%) elsewhere. */
  function needOn(key: string): bigint {
    const charge = toUnits(check?.charge ?? check?.total ?? "0");
    return key === "arc" ? charge : charge + charge / 5_000n + 1n;
  }

  async function connect() {
    if (!check?.draft || !config || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      const account = await (await loadWalletBridge(config, projectId)).connect();
      rememberWallet(storage(), true);
      setWallet(account);
      if (!config.crossPay) return void (await reserve(account, "arc"));
      setPayer(account);
      const options = payOptions(config);
      const read = await readFunds(
        options.map((o) => o.source),
        account,
      );
      setFunds(read);
      const ranked = options.map((o) => o.key);
      setFrom(ranked.find((k) => pickChain(read.filter((f) => f.key === k), needOn(k)) === k) ?? null);
    } catch (err) {
      if (err instanceof Error && err.message === "closed") return;
      setError({ text: errorMessage(err), limit: false });
    } finally {
      setBusy(false);
    }
  }

  async function reserve(account: `0x${string}`, key: string) {
    if (!check?.draft) return;
    setBusy(true);
    setError(null);
    try {
      const body = { draftId: check.draft.id, draftHash: check.draft.hash, payer: account, email: null };
      if (key === "arc") setPrepared(await api<Prepared>("/api/visitor/prepare", { body }));
      else setCrossPrepared(await api<CrossPrepared>("/api/visitor/prepare", { body: { ...body, sourceChain: key } }));
    } catch (err) {
      if (err instanceof Error && err.message === "closed") return;
      setError({ text: errorMessage(err), limit: err instanceof ApiError && err.code === "SEND_LIMIT" });
      if (err instanceof ApiError && (err.code === "LIST_CHANGED" || err.code === "LIST_ALREADY_PAID")) setCheck(null);
    } finally {
      setBusy(false);
    }
  }

  async function burned(hash: `0x${string}`) {
    const token = crossPrepared!.payment.token!;
    // The link works even if this report never arrives: the server finds the burn on its chain.
    router.push(`/p/${token}`);
    await api("/api/visitor/burn", { body: { token, txHash: hash } }).catch(() => undefined);
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
      <VisitorHeader config={config} wide />
      {/* One column on a phone. From lg (UI_BRIEF.md v5): the list on the left, its review and the
          payment on the right, so both stay in view. */}
      <main className="enter mx-auto max-w-md px-5 pt-4 pb-16 lg:grid lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-x-10 lg:gap-y-6 lg:px-10">
        {/* The heading spans both columns, so the list and its review start on the same line. */}
        <div className="mb-6 lg:col-span-2 lg:mb-0">
          <BackLink />
          <h1 className="mt-2 text-title leading-tight font-extrabold">Pay from your wallet</h1>
          <p className="mt-2 text-muted-foreground">No account needed. Pay anyone by email or Arc address, in one transaction.</p>
        </div>

        <div className="space-y-6">

          <Segmented
            kind="tabs"
            label="Who gets paid"
            idBase={tabs}
            options={[
              { value: "one", label: "One person" },
              { value: "many", label: "Many people" },
            ]}
            value={mode}
            onChange={(next) => {
              setMode(next);
              onChecked(null);
            }}
          />

          <div className="surface p-5" {...tabPanelProps(tabs, mode)}>
            <PayoutComposer
              key={`${mode}:${prefill?.to ?? ""}`}
              mode={mode}
              initialLabel={prefill?.label ?? "payment"}
              onChecked={onChecked}
              checkPath="/api/visitor/check"
              vocabulary="wallet"
              initialWho={mode === "one" ? (prefill?.to ?? "") : ""}
              initialAmount={mode === "one" ? (prefill?.amount ?? "") : ""}
            />
          </div>
        </div>

        <div className="mt-6 space-y-6 lg:mt-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-1 lg:-m-1">
          {!check && !prepared && (
            <p className="surface hidden p-5 text-sm text-muted-foreground lg:block">
              Check the list and the review appears here: who gets what, the fee, and the total your wallet pays.
            </p>
          )}
          {check && <ReviewTable check={check} />}

          {check?.ready && !prepared && !crossPrepared && !payer && (
            <div className="surface space-y-4 p-5">
              {check.fee && check.charge && <FeeLines fee={check.fee} percent={check.feePercent} total={check.charge} />}
              {!config?.live ? (
                <Notice>Wallet payments need a live server. This one is a preview.</Notice>
              ) : !projectId ? (
                <Notice>Wallet payments aren&apos;t set up on this server yet.</Notice>
              ) : (
                <Button className="w-full" busy={busy} onClick={() => void connect()}>
                  Pay ${check.charge ?? check.total} from your wallet
                </Button>
              )}
            </div>
          )}

          {wallet && (
            <p className="text-sm text-muted-foreground">
              Paying from {wallet.slice(0, 6)}…{wallet.slice(-4)}.{" "}
              <button type="button" onClick={() => void switchWallet()} className="font-semibold text-primary-text underline underline-offset-4">
                Use another wallet
              </button>
            </p>
          )}

          {payer && config && !prepared && !crossPrepared && (
            <div className="surface space-y-4 p-5">
              <ChainPicker options={payOptions(config)} funds={funds} needOf={needOn} value={from} onChange={setFrom} />
              <Button className="w-full" busy={busy} disabled={!from} onClick={() => from && void reserve(payer, from)}>
                Continue
              </Button>
            </div>
          )}

          {crossPrepared && config && (
            <div className="surface p-5">
              <CrossWalletSteps
                config={config}
                payment={crossPrepared.payment}
                call={crossPrepared.call}
                cost={crossPrepared.cost}
                chainName={crossPrepared.payment.cross?.chainName ?? "the source chain"}
                gas={config.crossPay?.chains.find((c) => c.key === crossPrepared.payment.cross?.chain)?.gas ?? "gas"}
                onBurned={(h) => void burned(h)}
                onPending={() => router.push(`/p/${crossPrepared.payment.token}`)}
              />
            </div>
          )}

          {prepared && config && (
            <div className="surface p-5">
              <WalletSteps config={config} prepared={prepared} onSent={(h) => void sent(h)} />
            </div>
          )}

          {error && (error.limit ? <VisitorLimit message={error.text} signedIn={false} /> : <Notice tone="error">{error.text}</Notice>)}
        </div>
      </main>
    </div>
  );
}

/** This device's storage, or null where it isn't available (private mode, server render). */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
