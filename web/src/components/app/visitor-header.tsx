"use client";

import Link from "next/link";
import { EnvBadge } from "@/components/app/env-badge";
import { Logo } from "@/components/app/logo";
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
  const badge = c && (!c.live ? "preview" : c.network === "arc-testnet" ? "testnet" : null);

  return (
    <header className={`mx-auto flex max-w-md items-center justify-between gap-3 px-5 pt-5 pb-2${wide ? " lg:max-w-5xl lg:px-10" : ""}`}>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Logo />
      </Link>
      {badge && (
        <EnvBadge mode={badge} />
      )}
    </header>
  );
}
