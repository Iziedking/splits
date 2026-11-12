"use client";

import { FileSpreadsheet, LayoutGrid, LogOut, PieChart, Send, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Logo } from "@/components/app/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { NEAR, accountUrl } from "@/lib/near/config";
import { cn } from "@/lib/utils";
import { useNearWallet } from "./wallet";

/** The app's sections, in the order people use them. */
const APP_NAV: { href: string; label: string; short: string; icon: LucideIcon }[] = [
  { href: "/near/app", label: "Overview", short: "Overview", icon: LayoutGrid },
  { href: "/near/split", label: "Auto-split my income", short: "Auto-split", icon: PieChart },
  { href: "/near/send", label: "Pay a split", short: "Pay", icon: Send },
  { href: "/near/payroll", label: "Payroll from a CSV", short: "Payroll", icon: FileSpreadsheet },
  { href: "/near/group", label: "Group fund", short: "Group", icon: Users },
];

function NetworkTag({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "light" ? "bg-white/60 text-muted-foreground ring-1 ring-foreground/10" : "bg-white/12 text-white/85 ring-1 ring-white/15",
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", tone === "light" ? "bg-primary" : "bg-white")} />
      NEAR {NEAR.network}
    </span>
  );
}

/** Connect, or the connected account. Closing the wallet picker is a choice, not an error. */
function useConnect() {
  const { ready, accountId, signIn, signOut } = useNearWallet();
  const [error, setError] = React.useState<string | null>(null);
  const connect = async () => {
    setError(null);
    try {
      await signIn();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/reject|cancel|closed/i.test(message)) return;
      setError(message || "The wallet did not connect");
    }
  };
  return { ready, accountId, connect, signOut, error };
}

function Footer() {
  return (
    <footer className="border-t border-foreground/8 pt-6 text-xs leading-relaxed text-muted-foreground">
      Splits on NEAR {NEAR.network}. Payments go through the{" "}
      <a className="underline underline-offset-2" href={accountUrl(NEAR.router)} target="_blank" rel="noreferrer">
        splits router
      </a>{" "}
      contract, which has no owner. Testnet money has no value.{" "}
      <Link className="underline underline-offset-2" href="/near/how">
        How it works and its limits
      </Link>
      .
    </footer>
  );
}

// ------------------------------------------------------------------ the public site

/** Landing, how it works, pay links and receipts: a full-width bar and one way into the app. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <header className="sticky top-0 z-20 w-full border-b print:hidden border-white/70 bg-white/55 backdrop-blur-md">
        <div className="flex items-center gap-4 px-4 py-3 sm:px-8 lg:px-10">
          <Link href="/near" className="flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none" aria-label="Splits on NEAR, home">
            <Logo className="h-7 w-auto" />
            <NetworkTag />
          </Link>
          <nav aria-label="Site" className="ml-auto hidden items-center gap-6 text-sm font-medium text-muted-foreground sm:flex">
            <Link className="transition-colors hover:text-foreground" href="/near#how">
              How it works
            </Link>
            <Link className="transition-colors hover:text-foreground" href="/near#proof">
              Check it yourself
            </Link>
          </nav>
          <ButtonLink href="/near/app" size="sm" className="ml-auto sm:ml-0">
            Open the app
          </ButtonLink>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-8 pb-12 sm:px-8">
        <main className="flex-1">{children}</main>
        <div className="mt-24 print:hidden">
          <Footer />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the app

/**
 * The app frame, after the Arc app's desktop layout (UI_BRIEF.md v5): a teal sidebar with labels on
 * desktop, a top bar and a bottom tab bar on phones. The wallet lives in the sidebar's foot.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { ready, accountId, connect, signOut, error } = useConnect();
  const current = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh w-full lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-primary-fill px-4 py-6 text-white lg:flex">
        <Link href="/near" className="flex items-center gap-2 rounded-md px-2 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none" aria-label="Splits on NEAR, home">
          <Logo tone="white" className="h-7 w-auto" />
        </Link>
        <div className="mt-3 px-2">
          <NetworkTag tone="dark" />
        </div>
        <nav aria-label="App" className="mt-8 flex flex-col gap-1">
          {APP_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={current(href) ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
                current(href) && "bg-white/15 text-white",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-white/10 p-3">
          {accountId ? (
            <>
              <p className="text-xs text-white/70">Connected</p>
              <a href={accountUrl(accountId)} target="_blank" rel="noreferrer" className="mt-0.5 block font-mono text-micro break-all text-white underline-offset-4 hover:underline">
                {accountId}
              </a>
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md text-sm text-white/80 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-white/85">Connect a NEAR wallet to pay and save your split.</p>
              <button
                type="button"
                disabled={!ready}
                onClick={() => void connect()}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-primary-fill transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-fill focus-visible:outline-none disabled:opacity-60"
              >
                Connect NEAR wallet
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Phones and tablets: a top bar with the wallet, and tabs at the bottom. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/70 bg-white/60 px-4 py-3 backdrop-blur-md lg:hidden">
        <Link href="/near" aria-label="Splits on NEAR, home">
          <Logo className="h-6 w-auto" />
        </Link>
        <NetworkTag />
        <div className="ml-auto">
          {accountId ? (
            <a href={accountUrl(accountId)} target="_blank" rel="noreferrer" className="block max-w-[9rem] truncate font-mono text-xs text-foreground">
              {accountId}
            </a>
          ) : (
            <Button size="sm" busy={!ready} onClick={() => void connect()}>
              Connect
            </Button>
          )}
        </div>
      </header>

      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-8 pb-28 sm:px-8 lg:pt-12 lg:pb-12">
        {error && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <main className="flex-1">{children}</main>
        <div className="mt-16">
          <Footer />
        </div>
      </div>

      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-20 border-t border-white/70 bg-white/80 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <ul className="grid grid-cols-5">
          {APP_NAV.map(({ href, short, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={current(href) ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium text-muted-foreground transition-colors",
                  current(href) && "text-primary-text",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                {short}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
