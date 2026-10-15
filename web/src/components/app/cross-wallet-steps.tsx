"use client";

import * as React from "react";
import type { Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import type { CrossCall, CrossCost, VisitorConfig, VisitorPaymentView } from "@/lib/api";
import { loadWalletBridge, type WalletBridge } from "@/lib/wallet/bridge";
import { crossWalletError, markBurnSent } from "@/lib/wallet/crossFlow";
import { walletError } from "@/lib/wallet/flow";

type Phase = "ready" | "approving" | "paying";

/**
 * Paying from another chain: the full cost, then one tap. The wallet switches to that chain, allows
 * exactly the burn (skipped when it already does, folded in when the wallet batches calls), and
 * burns. The hash goes to the page as soon as the wallet returns it; the server checks it there.
 */
export function CrossWalletSteps({
  config,
  payment,
  call,
  cost,
  chainName,
  gas,
  onBurned,
  onPending,
}: {
  config: VisitorConfig;
  payment: VisitorPaymentView;
  call: CrossCall;
  cost: CrossCost | null;
  chainName: string;
  gas: string;
  onBurned: (hash: Hex) => void;
  /** The wallet took the payment but hasn't confirmed it yet (a batched payment that timed out). */
  onPending: () => void;
}) {
  const [phase, setPhase] = React.useState<Phase>("ready");
  const [needsApprove, setNeedsApprove] = React.useState<boolean | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const paying = React.useRef(false);
  const payer = payment.payer as `0x${string}`;
  const burnAmount = BigInt(call.burnAmount);

  const bridge = React.useCallback(async (): Promise<WalletBridge> => {
    const b = await loadWalletBridge(config, process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!);
    if (b.account()?.toLowerCase() !== payer.toLowerCase()) throw new Error(`wrong-account:${payer}`);
    return b;
  }, [config, payer]);

  React.useEffect(() => {
    let live = true;
    bridge()
      .then((b) => b.allowanceOn(call.chainId, call.usdc, payer, call.tokenMessenger))
      .then((a) => live && setNeedsApprove(a < burnAmount))
      .catch(() => live && setNeedsApprove(true));
    return () => {
      live = false;
    };
  }, [bridge, call, payer, burnAmount]);

  function burned(hash: Hex) {
    markBurnSent(typeof window === "undefined" ? null : window.localStorage, payment.token!);
    onBurned(hash);
  }

  async function pay() {
    // Guard before the wallet prompt: a second tap must not open a second burn.
    if (paying.current) return;
    paying.current = true;
    setError(null);
    try {
      const b = await bridge();
      await b.ensureChain(call.chainId);
      if ((await b.allowanceOn(call.chainId, call.usdc, payer, call.tokenMessenger)) < burnAmount) {
        setPhase("approving");
        const batched = await b.batchApproveAndBurn(call.chainId, { token: call.usdc, spender: call.tokenMessenger, amount: burnAmount }, { to: call.tokenMessenger, data: call.data }, payer);
        if (batched) return burned(batched);
        const approved = await b.approveOn(call.chainId, call.usdc, call.tokenMessenger, burnAmount, payer);
        if ((await b.waitOn(call.chainId, approved)) !== "success") throw new Error("approve-reverted");
      }
      setPhase("paying");
      burned(await b.burnOn(call.chainId, call.tokenMessenger, call.data, payer));
    } catch (err) {
      const text = err instanceof Error ? err.message : "";
      if (text === "bundle-pending") {
        // Keep the button locked: paying again could burn twice.
        markBurnSent(typeof window === "undefined" ? null : window.localStorage, payment.token!);
        setError(crossWalletError(err, chainName));
        return onPending();
      }
      paying.current = false;
      setPhase("ready");
      setError(text.startsWith("wrong-account:") ? walletError(err, config) : crossWalletError(err, chainName));
    }
  }

  return (
    <div className="space-y-4">
      {cost && (
        <dl className="space-y-2 text-sm">
          <Line label="Split" value={`$${cost.amount}`} />
          <Line label="Splits fee" value={`$${cost.fee}`} />
          <Line label="Circle's fee, at most" value={`$${cost.circleMax}`} note="Any unused part comes back to you on Arc." />
          <Line label="Your network fee" value={`Paid in ${gas} on ${chainName}`} />
          <div className="border-t border-white pt-2">
            <Line label="Total from your wallet" value={`$${cost.total}`} strong />
          </div>
          {!cost.fast && <p className="text-xs text-muted-foreground">Standard route: lands on Arc in about 15 minutes.</p>}
        </dl>
      )}
      <Button className="w-full" busy={phase !== "ready"} disabled={needsApprove === null} onClick={() => void pay()}>
        {phase === "approving"
          ? "Allowing in your wallet…"
          : phase === "paying"
            ? "Confirm in your wallet…"
            : needsApprove
              ? `Pay from ${chainName} (2 steps)`
              : `Pay from ${chainName}`}
      </Button>
      <p className="text-sm text-muted-foreground">
        {needsApprove
          ? `Your wallet asks twice: once to allow exactly $${cost?.total ?? ""}, then to pay. Some wallets do both in one step.`
          : "Your wallet asks once. Nothing is signed on Arc."}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function Line({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
        <dd className={strong ? "font-extrabold tabular-nums" : "tabular-nums"}>{value}</dd>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
