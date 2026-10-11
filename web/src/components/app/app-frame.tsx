"use client";

import { Home, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { api, ApiError, errorMessage, type Me } from "@/lib/api";
import { Backdrop } from "@/components/app/backdrop";
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
 */
export function AppFrame({ children, requirePin = true }: { children: React.ReactNode; requirePin?: boolean }) {
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
    <div className={cn("min-h-screen transition-colors duration-500", night && "text-white")}>
      <Backdrop tone={tone} />
      {/* Mobile composition at every width until the designer's PC view lands (UI_BRIEF.md v4). */}
      <header className="mx-auto flex max-w-md items-center justify-between gap-3 px-5 pt-5 pb-2">
        <Link
          href="/home"
          className="inline-flex min-h-11 items-center rounded-lg text-xl font-extrabold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Splits
        </Link>
        {me && (me.mode === "preview" || me.network === "arc-testnet") && (
          <span
            className="rounded-full bg-purpose-4 px-3 py-1 text-xs font-bold text-foreground"
            title={me.mode === "preview" ? "Money on this server is simulated" : "This server uses Arc Testnet USDC, which has no value"}
          >
            {me.mode === "preview" ? "Preview" : "Testnet"}
          </span>
        )}
      </header>

      <main className="mx-auto max-w-md px-5 pb-32">
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
            "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 grid w-[calc(100%-2.5rem)] max-w-[24rem] -translate-x-1/2 grid-cols-3 rounded-full p-1",
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
