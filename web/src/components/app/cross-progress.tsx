"use client";

import { CircleAlert } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import type { VisitorConfig, VisitorPaymentView } from "@/lib/api";
import { loadWalletBridge } from "@/lib/wallet/bridge";
import { walletError } from "@/lib/wallet/flow";
import { cn } from "@/lib/utils";

type Cross = NonNullable<VisitorPaymentView["cross"]>;

/**
 * A payment from another chain, from real server state: Left <chain>, Confirmed by Circle, Paid on
 * Arc, Receipt checked. The message under the steps says what's happening and whether to act.
 */
export function CrossProgress({ cross, payer, config }: { cross: Cross; payer: string; config: VisitorConfig | null }) {
  const steps = [`Left ${cross.chainName}`, "Confirmed by Circle", "Paid on Arc", "Receipt checked"];
  return (
    <div className="space-y-4">
      <ol aria-label="Progress" className="surface space-y-4 p-5">
        {steps.map((label, i) => {
          const done = cross.step > i;
          const current = cross.step === i && cross.tone !== "error";
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "h-4 w-4 shrink-0 rounded-full",
                  done ? "bg-primary" : current ? "border-2 border-primary motion-safe:animate-pulse" : "border-2 border-muted-foreground/40",
                )}
              />
              <span className={cn("font-medium", !done && !current && "text-muted-foreground")}>{label}</span>
            </li>
          );
        })}
      </ol>
      <Notice tone={cross.tone === "error" ? "error" : cross.tone === "done" ? "success" : "info"} className="flex items-start gap-2">
        {cross.tone === "error" && <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        {cross.message}
      </Notice>
      {cross.owed && cross.crossPay && config && <ClaimRefund crossPay={cross.crossPay as `0x${string}`} payer={payer as `0x${string}`} config={config} />}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {cross.burnUrl && (
          <a href={cross.burnUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-4">
            View on {cross.chainName}
          </a>
        )}
        {cross.relayUrl && (
          <a href={cross.relayUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-4">
            View on Arc
          </a>
        )}
      </div>
    </div>
  );
}

/** A refund SplitsCrossPay is holding for this wallet: one signature on Arc sends it back. */
function ClaimRefund({ crossPay, payer, config }: { crossPay: `0x${string}`; payer: `0x${string}`; config: VisitorConfig }) {
  const [state, setState] = React.useState<{ busy: boolean; done: boolean; error: string | null }>({ busy: false, done: false, error: null });

  async function claim() {
    setState({ busy: true, done: false, error: null });
    try {
      const b = await loadWalletBridge(config, process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!);
      const account = b.account() ?? (await b.connect());
      if (account.toLowerCase() !== payer.toLowerCase()) throw new Error(`wrong-account:${payer}`);
      const hash = await b.claimOnArc(crossPay, payer);
      if ((await b.waitFor(hash)) !== "success") throw new Error("reverted");
      setState({ busy: false, done: true, error: null });
    } catch (err) {
      setState({ busy: false, done: false, error: walletError(err, config) });
    }
  }

  if (state.done) return <Notice tone="success">Your refund is back in your wallet on Arc.</Notice>;
  return (
    <div className="space-y-2">
      <Button className="w-full" busy={state.busy} onClick={() => void claim()}>
        Claim your refund on Arc
      </Button>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </div>
  );
}
