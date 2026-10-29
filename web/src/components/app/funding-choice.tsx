"use client";

import { motion, useReducedMotion } from "motion/react";
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
  if (!demoCard) return null;
  return (
    <div role="radiogroup" aria-label="Pay from" className="grid grid-cols-2 gap-2">
      {(["balance", "card"] as const).map((option) => {
        const disabled = option === "balance" && !balanceCovers;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            disabled={disabled}
            onClick={() => onChange(option)}
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
  const reduce = useReducedMotion();
  if (!demoCard) return null;
  return (
    <div role="radiogroup" aria-label="Pay with" className="relative grid grid-cols-2 rounded-full bg-white/60 p-1 ring-1 ring-white">
      {(["balance", "card"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "relative z-10 min-h-11 rounded-full text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === option ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === option && (
            <motion.span
              layoutId="fund-with"
              className="absolute inset-0 -z-10 rounded-full bg-primary-fill"
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
            />
          )}
          {option === "balance" ? `Balance, $${balance}` : "Test card"}
        </button>
      ))}
    </div>
  );
}
