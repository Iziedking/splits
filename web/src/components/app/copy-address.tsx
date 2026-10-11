"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** A wallet address, shortened, with a copy button that confirms in place. */
export function CopyAddress({ address, tone = "light", className }: { address: string; tone?: "light" | "dark"; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
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
      aria-label={`Copy your address, ${address}`}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        tone === "light" ? "bg-white/10 text-white hover:bg-white/15" : "bg-secondary text-secondary-foreground hover:bg-accent",
        className,
      )}
    >
      <span>
        {address.slice(0, 6)}…{address.slice(-4)}
      </span>
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      <span role="status" className="sr-only">
        {copied ? "Address copied" : ""}
      </span>
    </button>
  );
}
