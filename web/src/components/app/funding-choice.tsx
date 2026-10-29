"use client";

import * as React from "react";
import { nextIndex, Segmented } from "@/components/app/segmented";
import { cn } from "@/lib/utils";

export type FundWith = "card" | "balance";

/**
 * Where a payment is paid from. The balance is the default everywhere. The test card (a simulated
 * card that releases real money from the treasury, FUNDING_ENABLED) is offered only where `/api/me`
 * says `demoCard` is true, which is never on live mainnet. With the card off there is nothing to
 * choose, so both controls render nothing and the screen pays from the balance.
 */
export function FundingChoice({
  demoCard,
  value,
  onChange,
  balance,
  balanceCovers,
}: {
  demoCard: boolean;
  value: FundWith;
  onChange: (next: FundWith) => void;
  /** The main balance as a decimal string. */
  balance: string;
  /** Whether the balance covers the total; when it does not, the balance option is disabled. */
  balanceCovers: boolean;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  if (!demoCard) return null;
  const options = ["balance", "card"] as const;
  const off = options.map((o) => o === "balance" && !balanceCovers);
  return (
    <div role="radiogroup" aria-label="Pay from" className="grid grid-cols-2 gap-2">
      {options.map((option, i) => {
        const disabled = off[i]!;
        return (
          <button
            key={option}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === option}
            tabIndex={value === option || (off[options.indexOf(value)] && !disabled) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option)}
            onKeyDown={(e) => {
              const to = nextIndex(e.key, i, off);
              if (to === null) return;
              e.preventDefault();
              onChange(options[to]!);
              refs.current[to]?.focus();
            }}
            className={cn(
              "min-h-16 rounded-md px-4 py-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
              value === option ? "bg-white ring-2 ring-primary" : "bg-white/60 ring-1 ring-white hover:bg-white",
            )}
          >
            <span className="block font-semibold">{option === "balance" ? "Balance" : "Test card"}</span>
            <span className="block text-muted-foreground">
              {option === "balance" ? (disabled ? `$${balance}, not enough` : `$${balance}`) : "No real card is charged. Small daily limit."}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The same choice as a segmented control, for the saved-split amount screen. */
export function FundingToggle({
  demoCard,
  value,
  onChange,
  balance,
}: {
  demoCard: boolean;
  value: FundWith;
  onChange: (next: FundWith) => void;
  balance: string;
}) {
  if (!demoCard) return null;
  return (
    <Segmented
      kind="radio"
      label="Pay with"
      animated
      options={[
        { value: "balance", label: `Balance, $${balance}` },
        { value: "card", label: "Test card" },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
