"use client";

import * as React from "react";
import type { Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import type { ContractLeg, VisitorConfig, VisitorPaymentView } from "@/lib/api";
import { loadWalletBridge, type WalletBridge } from "@/lib/wallet/bridge";

type Prepared = { payment: VisitorPaymentView; legs: ContractLeg[]; balance: string; allowance: string };
type Phase = "approve" | "approving" | "send" | "sending";

const usd = (units: bigint) => `${units / 1_000_000n}.${((units % 1_000_000n) / 10_000n).toString().padStart(2, "0")}`;
/** "12.5" -> 12_500_000n, exactly. */
const toUnits = (amount: string) => {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
};

/**
 * The two signatures, in order. Step 1 is skipped when the wallet already allows enough. Once the
 * send is signed, the hash goes to the page straight away and is never replaced.
 */
export function WalletSteps({ config, prepared, onSent }: { config: VisitorConfig; prepared: Prepared; onSent: (hash: Hex) => void }) {
  const total = toUnits(prepared.payment.total);
  const short = total - BigInt(prepared.balance);
  const [phase, setPhase] = React.useState<Phase>(BigInt(prepared.allowance) >= total ? "send" : "approve");
  const [error, setError] = React.useState<string | null>(null);
  const sending = React.useRef(false);
  const payer = prepared.payment.payer as `0x${string}`;

  /** The wallet, on Arc, with the reserved account selected; anything else stops before signing. */
  async function bridge(): Promise<WalletBridge> {
    const b = await loadWalletBridge(config, process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!);
    if (b.account()?.toLowerCase() !== payer.toLowerCase()) throw new Error(`wrong-account:${payer}`);
    await b.ensureArc();
    return b;
  }

  async function approve() {
    setError(null);
    setPhase("approving");
    try {
      const b = await bridge();
      const hash = await b.approve(total, payer);
      if ((await b.waitFor(hash)) !== "success") throw new Error("reverted");
      setPhase("send");
    } catch (err) {
      setPhase("approve");
      setError(walletError(err));
    }
  }

  async function send() {
    // Guard before the wallet prompt, not after: a second tap must not open a second send.
    if (sending.current) return;
    sending.current = true;
    setError(null);
    setPhase("sending");
    try {
      const b = await bridge();
      onSent(await b.pay(prepared.legs, total, prepared.payment.ref as Hex, payer));
    } catch (err) {
      // A retry is safe: the server settles on whichever send of this reservation reached Arc.
      sending.current = false;
      setPhase("send");
      setError(walletError(err));
    }
  }

  if (short > 0n) {
    return (
      <Notice tone="error">
        This wallet needs ${usd(short)} more USDC on {config.network === "arc" ? "Arc" : "Arc Testnet"}.
        {config.network === "arc-testnet" && (
          <>
            {" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">
              Get testnet USDC
            </a>
          </>
        )}
      </Notice>
    );
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        <li>
          <Button className="w-full" variant={phase === "approve" || phase === "approving" ? "primary" : "secondary"} disabled={phase !== "approve"} busy={phase === "approving"} onClick={() => void approve()}>
            1 of 2: Allow Splits to send exactly ${prepared.payment.total}
          </Button>
        </li>
        <li>
          <Button className="w-full" disabled={phase !== "send"} busy={phase === "sending"} onClick={() => void send()}>
            2 of 2: Send
          </Button>
        </li>
      </ol>
      <p className="text-sm text-muted-foreground">
        Your wallet shows each step. The first allows this exact amount and nothing more; the second pays everyone in one transaction.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function walletError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text.startsWith("wrong-account:")) {
    const want = text.slice("wrong-account:".length);
    return `Switch your wallet back to ${want.slice(0, 6)}…${want.slice(-4)}, the account this payment was set up for. Nothing moved.`;
  }
  if (/rejected|denied|User rejected/i.test(text)) return "You declined in your wallet. Nothing moved. Try again when you're ready.";
  if (/chain|network/i.test(text)) return "Your wallet didn't switch to Arc. Add Arc in your wallet's network settings, then try again.";
  if (text === "reverted") return "Arc rejected the approval. Nothing moved. Try again.";
  return "Your wallet couldn't finish this step. Nothing moved. Try again.";
}
