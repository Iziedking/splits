"use client";

import Link from "next/link";
import * as React from "react";
import { api, type VisitorConfig } from "@/lib/api";

/**
 * The header on pages people use without an account: the Splits mark, and a badge whenever the
 * money isn't real (preview) or has no value (Arc Testnet), so nobody mistakes a test for mainnet.
 */
export function VisitorHeader({ config, wide = false }: { config?: VisitorConfig | null; wide?: boolean }) {
  const [own, setOwn] = React.useState<VisitorConfig | null>(null);
  React.useEffect(() => {
    if (config !== undefined) return;
    api<VisitorConfig>("/api/visitor/config").then(setOwn).catch(() => undefined);
  }, [config]);
  const c = config ?? own;
  const badge = c && (!c.live ? "Preview" : c.network === "arc-testnet" ? "Testnet" : null);

  return (
    <header className={`mx-auto flex max-w-md items-center justify-between gap-3 px-5 pt-5 pb-2${wide ? " lg:max-w-5xl lg:px-10" : ""}`}>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-lg text-xl font-extrabold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Splits
      </Link>
      {badge && (
        <span
          className="rounded-full bg-purpose-4 px-3 py-1 text-xs font-bold text-foreground"
          title={badge === "Preview" ? "Money on this server is simulated" : "Arc Testnet USDC has no value"}
        >
          {badge}
        </span>
      )}
    </header>
  );
}
