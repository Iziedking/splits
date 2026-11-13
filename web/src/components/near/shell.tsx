"use client";

import { FileSpreadsheet, LayoutGrid, LogOut, PieChart, ReceiptText, Send, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { BackLink } from "@/components/app/back-link";
import { Logo } from "@/components/app/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { NEAR } from "@/lib/near/config";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { useNearWallet } from "./wallet";

/** The app's sections, in the order people use them. */
const APP_NAV: { href: string; label: string; short: string; icon: LucideIcon; phone?: false }[] = [
  { href: "/near/app", label: "Home", short: "Home", icon: LayoutGrid },
  { href: "/near/split", label: "Auto-split my income", short: "Auto-split", icon: PieChart },
  { href: "/near/send", label: "Pay people", short: "Pay", icon: Send },
  { href: "/near/bill", label: "Split a bill", short: "Bill", icon: ReceiptText },
  { href: "/near/payroll", label: "Payroll", short: "Payroll", icon: FileSpreadsheet, phone: false },
  { href: "/near/group", label: "Group fund", short: "Group", icon: Users },
  // Payroll and the checkout button are set up at a desk; the phone tab bar keeps the five everyday tabs.
  { href: "/near/button", label: "Checkout button", short: "Button", icon: ShoppingBag, phone: false },
];

/** "Test mode" while this runs on testnet, the way payment dashboards say it. Nothing on mainnet pages. */
function TestMode({ tone = "light" }: { tone?: "light" | "dark" }) {
  const path = usePathname();
  // Paying from another chain settles on NEAR mainnet with real money, so it never says test.
  if (NEAR.network !== "testnet" || path?.startsWith("/near/checkout")) return null;
  return (
    <span className={cn("rounded-full px-3 py-1 text-xs font-bold", tone === "light" ? "bg-purpose-4 text-foreground" : "bg-white/15 text-white")}>
      Test mode<span className="sr-only">. Payments use test money with no value.</span>
    </span>
  );
}

/** Sign in, or the signed-in account. Closing the sign-in is a choice, not an error. */
function useConnect() {
  const { ready, accountId, email, avatar, signIn, signOut } = useNearWallet();
  const [error, setError] = React.useState<string | null>(null);
  const connect = async () => {
    setError(null);
    try {
      await signIn();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/reject|cancel|closed/i.test(message)) return;
      setError(message || "Sign-in did not finish. Try again.");
    }
  };
  return { ready, accountId, name: email ?? accountId, avatar, connect, signOut, error };
}

/** The signed-in person as they see themselves: an initial and their email, or a wallet's name. */
function AccountChip({ id, src, tone = "light" }: { id: string; src?: string | null; tone?: "light" | "dark" }) {
  return (
    <Link
      href="/near/profile"
      aria-label={`Your profile, ${id}`}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-2 rounded-full pr-2 focus-visible:ring-2 focus-visible:outline-none",
        tone === "dark" ? "text-white hover:text-white/85 focus-visible:ring-white" : "text-foreground hover:text-foreground/80 focus-visible:ring-primary",
      )}
    >
      <Avatar label={id} src={src} />
      <span className={cn("min-w-0 truncate", id.includes("@") ? "text-sm" : "font-mono text-micro")}>{id}</span>
    </Link>
  );
}

function ConnectOrAccount() {
  const { ready, accountId, name, avatar, connect } = useConnect();
  return accountId && name ? (
    <AccountChip id={name} src={avatar} />
  ) : (
    <Button size="sm" busy={!ready} onClick={() => void connect()}>
      Sign in
    </Button>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-foreground/8 pt-6 text-sm text-muted-foreground">
      {NEAR.network === "testnet" ? "Splits on NEAR is in test mode: payments use test money with no value. " : "Splits on NEAR. "}
      <Link className="underline underline-offset-2" href="/near/how">
        How it works
      </Link>
    </footer>
  );
}

// ------------------------------------------------------------------ the public site

/** Landing and how it works: a calm bar and one way into the app. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <header className="sticky top-0 z-20 w-full border-b border-white/70 bg-white/55 backdrop-blur-md print:hidden">
        <div className="flex items-center gap-4 px-4 py-3 sm:px-8 lg:px-10">
          <Link href="/near" className="flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none" aria-label="Splits, home">
            <Logo className="h-7 w-auto" />
          </Link>
          <TestMode />
          <nav aria-label="Site" className="ml-auto hidden items-center gap-6 text-sm font-medium text-muted-foreground sm:flex">
            <Link className="transition-colors hover:text-foreground" href="/near/how">
              How it works
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
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one task, start to finish

/**
 * Paying a link, paying from another chain, a receipt: one task on one screen. A back control to
 * wherever the person came from, the logo, and who is signed in. Nothing else competes.
 */
export function FlowShell({ children }: { children: React.ReactNode }) {
  const { accountId } = useNearWallet();
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <header className="sticky top-0 z-20 w-full border-b border-white/70 bg-white/55 backdrop-blur-md print:hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3 sm:px-8">
          <BackLink fallback={accountId ? "/near/app" : "/near"} className="ml-0" />
          <Link href={accountId ? "/near/app" : "/near"} aria-label="Splits, home" className="rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
            <Logo className="h-6 w-auto" />
          </Link>
          <div className="flex min-w-0 justify-end">
            <ConnectOrAccount />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-16 sm:px-8 sm:pt-10">
        <div className="mb-5 flex justify-center">
          <TestMode />
        </div>
        {children}
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ the app

/**
 * The app frame, after the Arc app's desktop layout (UI_BRIEF.md v5): a teal sidebar with labels on
 * desktop, a top bar and a bottom tab bar on phones. Each page settles in as it opens.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { ready, accountId, name, avatar, connect, signOut, error } = useConnect();
  const current = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh w-full lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-primary-fill px-4 py-6 text-white lg:flex">
        <Link href="/near/app" className="flex items-center gap-2 rounded-md px-2 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none" aria-label="Splits, home">
          <Logo tone="white" className="h-7 w-auto" />
        </Link>
        <div className="mt-3 px-2">
          <TestMode tone="dark" />
        </div>
        <nav aria-label="App" className="mt-8 flex flex-col gap-1">
          {APP_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={current(href) ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/80 transition-[background-color,color,transform] duration-150 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98] motion-reduce:active:scale-100",
                current(href) && "bg-white/15 text-white",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-white/10 p-3">
          {accountId ? (
            <>
              <AccountChip id={name ?? accountId} src={avatar} tone="dark" />
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md text-sm text-white/80 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Sign out
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-white/85">Sign in with your email to pay people and save your split.</p>
              <button
                type="button"
                disabled={!ready}
                onClick={() => void connect()}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-primary-fill transition-[background-color,transform] duration-150 hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-fill focus-visible:outline-none active:scale-[0.98] disabled:opacity-60"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Phones and tablets: a top bar with the account, and tabs at the bottom. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/70 bg-white/60 px-4 py-3 backdrop-blur-md lg:hidden">
        <Link href="/near/app" aria-label="Splits, home">
          <Logo className="h-6 w-auto" />
        </Link>
        <TestMode />
        <div className="ml-auto flex min-w-0 justify-end">
          {accountId ? (
            <AccountChip id={name ?? accountId} src={avatar} />
          ) : (
            <Button size="sm" busy={!ready} onClick={() => void connect()}>
              Sign in
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
        {/* Keyed by page, so each one settles in as it opens instead of swapping in place. */}
        <main key={path} className="enter flex-1">
          {children}
        </main>
      </div>

      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-20 border-t border-white/70 bg-white/80 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <ul className="grid grid-cols-5">
          {APP_NAV.filter((n) => n.phone !== false).map(({ href, short, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={current(href) ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium text-muted-foreground transition-[color,transform] duration-150 active:scale-95 motion-reduce:active:scale-100",
                  current(href) && "text-primary-text",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={current(href) ? 2.25 : 1.75} aria-hidden="true" />
                {short}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
