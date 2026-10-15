"use client";

import { cn } from "@/lib/utils";
import { CROSS_WALLET_TEXT } from "@/lib/wallet/crossFlow";
import { unitsToUsd } from "@/lib/wallet/flow";
import type { ChainFunds } from "@/lib/wallet/sourceChains";

export type ChainOption = { key: string; name: string; gas: string; fast: boolean };

/**
 * Where the payer's USDC is: Arc, or one of the chains cross-chain pay is on. Each card shows what the
 * connected wallet holds there; a chain that can't cover the payment (or its network fee) is shown,
 * disabled, with what's missing.
 */
export function ChainPicker({
  options,
  funds,
  need,
  value,
  onChange,
}: {
  options: ChainOption[];
  funds: ChainFunds[] | null;
  need: bigint;
  value: string | null;
  onChange: (key: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold">Pay from</legend>
      {options.map((o) => {
        const f = funds?.find((x) => x.key === o.key);
        const short = f && !f.error && f.usdc < need;
        const noGas = f && !f.error && !short && f.gas === 0n;
        const disabled = !f || f.error || short || noGas;
        const note = !f
          ? null
          : f.error
            ? CROSS_WALLET_TEXT.unreadable(o.name)
            : short
              ? CROSS_WALLET_TEXT.short(unitsToUsd(f.usdc), o.name, unitsToUsd(need + 9_999n))
              : noGas
                ? CROSS_WALLET_TEXT.noGas(o.gas, o.name)
                : null;
        return (
          <label
            key={o.key}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-[14px] bg-white/70 p-4 ring-1 ring-white transition-colors",
              value === o.key && "ring-2 ring-primary",
              disabled && "cursor-not-allowed opacity-70",
            )}
          >
            <input
              type="radio"
              name="pay-from"
              className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
              checked={value === o.key}
              disabled={disabled}
              onChange={() => onChange(o.key)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{o.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">{f ? (f.error ? "—" : `$${unitsToUsd(f.usdc)} USDC`) : "…"}</span>
              </span>
              {o.key !== "arc" && (
                <span className="block text-xs text-muted-foreground">{o.fast ? "Lands on Arc in seconds" : "Lands on Arc in about a minute"}</span>
              )}
              {o.key === "eth" && <span className="block text-xs text-muted-foreground">Ethereum&apos;s network fee can run to a few dollars.</span>}
              {note && <span className="mt-1 block text-xs text-destructive">{note}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
