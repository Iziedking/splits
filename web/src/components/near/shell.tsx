"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { NEAR, accountUrl } from "@/lib/near/config";
import { cn } from "@/lib/utils";
import { useNearWallet } from "./wallet";

const NAV = [
  { href: "/near", label: "Home" },
  { href: "/near/send", label: "Pay a split" },
  { href: "/near/split", label: "Auto-split my income" },
];

export function NearShell({ children }: { children: React.ReactNode }) {
  const { ready, accountId, signIn, signOut } = useNearWallet();
  const path = usePathname();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 py-5">
        <Link href="/near" className="flex items-center gap-2" aria-label="Splits on NEAR, home">
          <Logo className="h-7 w-auto" />
          <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold text-white">
            NEAR {NEAR.network}
          </span>
        </Link>
        <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={path === n.href ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-white/60 hover:text-foreground",
                path === n.href && "bg-white/80 text-foreground ring-1 ring-white",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {accountId ? (
            <>
              <a href={accountUrl(accountId)} target="_blank" rel="noreferrer" className="max-w-[12rem] truncate text-sm font-semibold text-foreground" title={accountId}>
                {accountId}
              </a>
              <Button size="sm" variant="ghost" onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              busy={!ready}
              onClick={async () => {
                setError(null);
                try {
                  await signIn();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "The wallet did not connect");
                }
              }}
            >
              Connect NEAR wallet
            </Button>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <main className="flex-1">{children}</main>
      <footer className="mt-16 text-xs leading-relaxed text-muted-foreground">
        Splits on NEAR {NEAR.network}. Payments go through the{" "}
        <a className="underline" href={accountUrl(NEAR.router)} target="_blank" rel="noreferrer">
          splits router
        </a>{" "}
        contract, which has no owner. Testnet money has no value.{" "}
        <Link className="underline" href="/near/how">
          How it works and its limits
        </Link>
        .
      </footer>
    </div>
  );
}
