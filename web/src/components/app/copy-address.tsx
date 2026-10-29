"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** A value with a copy button that confirms in place. `what` names it for screen readers. */
export function CopyButton({
  value,
  shown = value,
  what,
  tone = "dark",
  className,
}: {
  value: string;
  /** The visible text, when it differs from what is copied. */
  shown?: string;
  what: string;
  tone?: "light" | "dark";
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${what}`}
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full px-4 text-sm font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        tone === "light" ? "bg-white/10 text-white hover:bg-white/15" : "bg-secondary text-secondary-foreground hover:bg-accent",
        className,
      )}
    >
      <span className="truncate">{shown}</span>
      {copied ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

/** The account address, shortened, with a copy button. */
export function CopyAddress({ address, tone = "light", className }: { address: string; tone?: "light" | "dark"; className?: string }) {
  return <CopyButton value={address} shown={`${address.slice(0, 6)}…${address.slice(-4)}`} what="your account address" tone={tone} className={className} />;
}
