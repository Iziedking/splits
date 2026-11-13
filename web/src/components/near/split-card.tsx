import * as React from "react";
import type { ReactNode } from "react";
import { PurposeDot } from "@/components/app/purpose-dot";
import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

import { AccountName } from "./account-name";

export { AccountName };

/** The split as separate rounded bars, one per part, in the purpose colours. Decoration: the rows say it. */
export function SplitBar({ weights, className }: { weights: number[]; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex h-2.5 gap-1.5", className)}>
      {weights.map((w, i) => (
        <span key={i} className="block h-full min-w-1.5 rounded-full" style={{ flexGrow: w, backgroundColor: purposeFill(i) }} />
      ))}
    </div>
  );
}

const DEMO = [
  { account: "tax.ada.testnet", purpose: "Tax", share: 30, amount: "300.00" },
  { account: "savings.ada.testnet", purpose: "Savings", share: 20, amount: "200.00" },
  { account: "ada.testnet", purpose: "Spending", share: 50, amount: "500.00" },
];

/**
 * The home page's moment: one payment to ada.testnet landing divided by her saved split, on the
 * deep teal of the Arc desktop welcome (UI_BRIEF.md v5). An illustration with example names, so it
 * is hidden from screen readers; the copy beside it says the same.
 */
export function LandingPanel({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative overflow-hidden rounded-[1.75rem] bg-primary-fill px-6 py-10 sm:px-10 sm:py-14", className)}>
      <div className="absolute -top-28 -left-20 h-80 w-80 rounded-full bg-purpose-1/55 blur-[90px]" />
      <div className="absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-purpose-2/45 blur-[100px]" />
      <div className="absolute bottom-1/4 left-1/3 h-56 w-56 rounded-full bg-purpose-3/25 blur-[90px]" />

      <div className="relative mx-auto w-full max-w-sm">
        <p className="flex items-center gap-2 text-sm text-white/85">
          <span className="font-mono">payroll.acme.testnet</span>
          <span>→</span>
          <span className="font-mono text-white">ada.testnet</span>
        </p>
        <div className="mt-3 rounded-2xl bg-white/95 p-6 text-foreground shadow-panel">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm text-muted-foreground">One payment</p>
            <p className="text-xs text-muted-foreground">Your rule</p>
          </div>
          <p className="figure mt-1 text-figure-lg leading-none tabular-nums">
            1,000.00 <span className="text-lg font-semibold text-muted-foreground">USDC</span>
          </p>
          <SplitBar className="mt-5" weights={DEMO.map((d) => d.share)} />
          <ul className="mt-5 space-y-3">
            {DEMO.map((d, i) => (
              <li key={d.account} className="flex items-center gap-3">
                <PurposeDot index={i} />
                <span className="min-w-0 flex-1">
                  <AccountName id={d.account} className="font-medium" />
                  <span className="block text-sm text-muted-foreground">
                    {d.purpose}, {d.share}%
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{d.amount}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 flex items-center gap-2 border-t border-foreground/8 pt-4 text-sm text-muted-foreground">
            <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-primary-text" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Divided automatically as it arrived.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Title and one line under it, the same on every NEAR page. */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="enter mb-8 max-w-2xl pt-4">
      <h1 className="display-face text-3xl leading-tight font-bold sm:text-4xl">{title}</h1>
      {children && <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">{children}</p>}
    </header>
  );
}
