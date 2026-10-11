"use client";

import { Home, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { api, ApiError, errorMessage, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";

type MeState = { me: Me; refresh: () => Promise<void> };
const MeContext = React.createContext<MeState | null>(null);

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/pay", label: "Pay", icon: Send },
  { href: "/profile", label: "Profile", icon: UserRound },
] as const;

/** "/pay" is current on /pay and /pay/..., but not on /payments. */
const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function useMe(): MeState {
  const value = React.useContext(MeContext);
  if (!value) throw new Error("useMe must be used inside AppFrame");
  return value;
}

/**
 * The signed-in shell. Loads the user once, sends signed-out visitors to sign in and anyone
 * without a PIN to set one, and shows a Preview tag whenever money is simulated.
 */
export function AppFrame({ children, requirePin = true }: { children: React.ReactNode; requirePin?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = React.useState<Me | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const data = await api<Me>("/api/me");
      setMe(data);
      setError(null);
      if (requirePin && !data.user.hasPin) router.replace("/setup");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/");
      else setError(errorMessage(err));
    }
  }, [requirePin, router]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-[75rem] items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link
          href="/home"
          className="inline-flex min-h-11 items-center rounded-lg display-face text-xl font-bold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Splits
        </Link>
        {me && pathname !== "/setup" && (
          <nav aria-label="Main" className="hidden items-center gap-1 rounded-full bg-card p-1 ring-1 ring-border sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2">
          {me && (me.mode === "preview" || me.network === "arc-testnet") && (
            <span
              className="rounded-full bg-purpose-1 px-3 py-1 text-xs font-bold text-primary"
              title={me.mode === "preview" ? "Money on this server is simulated" : "This server uses Arc Testnet USDC, which has no value"}
            >
              {me.mode === "preview" ? "Preview" : "Testnet"}
            </span>
          )}
          {me && (
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:inline" title={me.user.email}>
              {me.user.email}
            </span>
          )}
          {me && pathname !== "/setup" && (
            <Button variant="ghost" onClick={signOut} className="hidden px-3 sm:inline-flex">
              Sign out
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[75rem] px-4 pb-28 sm:px-6 sm:pb-20">
        {error && !me && (
          <div className="mx-auto mt-16 max-w-sm space-y-4">
            <Notice tone="error">{error}</Notice>
            <Button variant="secondary" onClick={() => void refresh()} className="w-full">
              Try again
            </Button>
          </div>
        )}
        {!me && !error && <FrameSkeleton />}
        {me && <MeContext.Provider value={{ me, refresh }}>{children}</MeContext.Provider>}
      </main>
      {me && pathname !== "/setup" && (
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[not(backdrop-filter:blur(0))]:bg-card sm:hidden"
        >
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isCurrent(pathname, href) ? "page" : undefined}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold text-muted-foreground focus-visible:bg-secondary focus-visible:outline-none aria-[current=page]:text-primary"
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

function FrameSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mt-4 space-y-6">
      <div className="h-44 rounded-[28px] bg-primary/15 motion-safe:animate-pulse" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-72 rounded-[20px] bg-muted motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}
