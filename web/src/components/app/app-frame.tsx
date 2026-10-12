"use client";

import { Home, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { api, ApiError, errorMessage, type Me } from "@/lib/api";
import { Backdrop } from "@/components/app/backdrop";
import { NotificationBell } from "@/components/app/notification-bell";
import { SideRail } from "@/components/app/side-rail";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type MeState = { me: Me; refresh: () => Promise<void> };
const MeContext = React.createContext<MeState | null>(null);

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/pay", label: "Send", icon: Send },
  { href: "/profile", label: "Profile", icon: UserRound },
] as const;

/** "/pay" is current on /pay and /pay/..., but not on /payments. */
const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

type Tone = "day" | "night";
const ToneContext = React.createContext<(tone: Tone) => void>(() => undefined);

/** Lets a screen (the live settlement screen) switch the whole frame to the night backdrop. */
export function useFrameTone(tone: Tone) {
  const setTone = React.useContext(ToneContext);
  React.useEffect(() => {
    setTone(tone);
    return () => setTone("day");
  }, [tone, setTone]);
}

export function useMe(): MeState {
  const value = React.useContext(MeContext);
  if (!value) throw new Error("useMe must be used inside AppFrame");
  return value;
}

/**
 * The signed-in shell. Loads the user once, sends signed-out visitors to sign in and anyone
 * without a PIN to set one, and shows a Preview tag whenever money is simulated.
 *
 * Phones get a centred column and a floating nav (UI_BRIEF.md v4). From `lg` up, a teal side rail
 * replaces the nav (v5); `wide` screens (Home) use the extra width, the rest stay a readable column.
 */
export function AppFrame({ children, requirePin = true, wide = false }: { children: React.ReactNode; requirePin?: boolean; wide?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = React.useState<Me | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tone, setTone] = React.useState<Tone>("day");
  const night = tone === "night";

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

  return (
    <div className={cn("min-h-screen transition-colors duration-500 lg:pl-24", night && "text-white")}>
      <Backdrop tone={tone} />
      {me && pathname !== "/setup" && <SideRail items={NAV} isCurrent={(href) => isCurrent(pathname, href)} />}
      <header className={cn("mx-auto flex max-w-md items-center justify-between gap-3 px-5 pt-5 pb-2 lg:px-10 lg:pt-8", wide ? "lg:max-w-6xl" : "lg:max-w-xl")}>
        <Link
          href="/home"
          className={cn(
            "inline-flex min-h-11 items-center rounded-lg text-xl font-extrabold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            // The rail carries the wordmark on desktop, except where it is hidden (PIN setup).
            pathname !== "/setup" && "lg:invisible",
          )}
        >
          Splits
        </Link>
        <div className="flex items-center gap-2">
          {me && (me.mode === "preview" || me.network === "arc-testnet") && (
            <span
              className="rounded-full bg-purpose-4 px-3 py-1 text-xs font-bold text-foreground"
              title={me.mode === "preview" ? "Money on this server is simulated" : "This server uses Arc Testnet USDC, which has no value"}
            >
              {me.mode === "preview" ? "Preview" : "Testnet"}
            </span>
          )}
          {me && <NotificationBell />}
        </div>
      </header>

      <main className={cn("mx-auto max-w-md px-5 pb-32 lg:px-10 lg:pb-16", wide ? "lg:max-w-6xl" : "lg:max-w-xl")}>
        {error && !me && (
          <div className="mt-16 space-y-4">
            <Notice tone="error">{error}</Notice>
            <Button variant="secondary" onClick={() => void refresh()} className="w-full">
              Try again
            </Button>
          </div>
        )}
        {!me && !error && <FrameSkeleton />}
        {me && (
          <ToneContext.Provider value={setTone}>
            <MeContext.Provider value={{ me, refresh }}>{children}</MeContext.Provider>
          </ToneContext.Provider>
        )}
      </main>
      {me && pathname !== "/setup" && (
        <nav
          aria-label="Main"
          className={cn(
            "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 grid w-[calc(100%-2.5rem)] max-w-[24rem] -translate-x-1/2 grid-cols-3 rounded-full p-1 lg:hidden",
            night ? "surface-night" : "surface",
          )}
        >
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isCurrent(pathname, href) ? "page" : undefined}
              className={cn(
                "flex min-h-12 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground",
                night ? "text-white/70" : "text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
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
    <div aria-busy="true" aria-label="Loading" className="mt-6 space-y-5">
      <div className="h-10 w-40 rounded-full bg-white/60 motion-safe:animate-pulse" />
      <div className="surface h-36 motion-safe:animate-pulse" />
      <div className="surface h-24 motion-safe:animate-pulse" />
    </div>
  );
}
