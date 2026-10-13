"use client";

import { Home, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { api, ApiError, errorMessage, type Me } from "@/lib/api";
import { Backdrop } from "@/components/app/backdrop";
import { Loader } from "@/components/app/loader";
import { Logo } from "@/components/app/logo";
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
 * Phones get a centred column and a floating nav (UI_BRIEF.md v4). From `lg` up, the teal rail
 * replaces the nav (v5); `wide` screens (Home, History) use the extra width beside it, the rest stay
 * a readable column.
 */
export function AppFrame({ children, requirePin = true, wide = false }: { children: React.ReactNode; requirePin?: boolean; wide?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = React.useState<Me | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tone, setTone] = React.useState<Tone>("day");
  const night = tone === "night";
  const [railOpen, setRailOpen] = React.useState(false);

  // Whether the desktop rail shows labels is a per-browser preference; storage may be unavailable.
  React.useEffect(() => {
    try {
      setRailOpen(localStorage.getItem("splits:rail") === "open");
    } catch {
      // Private window or blocked storage: start closed.
    }
  }, []);
  const toggleRail = () =>
    setRailOpen((open) => {
      try {
        localStorage.setItem("splits:rail", open ? "closed" : "open");
      } catch {
        // Not remembered; still toggles.
      }
      return !open;
    });
  // Home uses the whole width beside the rail like the frame; other screens are a centred,
  // readable column. The header always spans the page, its badge and bell at the far right.
  const width = wide ? "lg:mx-0 lg:max-w-[110rem] lg:px-12" : "lg:max-w-3xl lg:px-10";

  const refresh = React.useCallback(async () => {
    try {
      const data = await api<Me>("/api/me");
      setMe(data);
      setError(null);
      if (requirePin && !data.user.hasPin) router.replace("/setup");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/signin");
      else setError(errorMessage(err));
    }
  }, [requirePin, router]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className={cn("min-h-screen transition-[padding,color] duration-200", railOpen ? "lg:pl-56" : "lg:pl-20", night && "text-white")}>
      <Backdrop tone={tone} />
      {/* Drawn at once (not after the account loads) so it never pops in; signed-out visitors are sent away anyway. */}
      {pathname !== "/setup" && <SideRail open={railOpen} onToggle={toggleRail} />}
      <header className="mx-auto flex max-w-md items-center justify-between gap-3 px-5 pt-5 pb-2 lg:max-w-none lg:px-12 lg:pt-8">
        <Link
          href="/"
          aria-label="Splits home"
          className={cn(
            "inline-flex min-h-11 items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          )}
        >
          <Logo tone={night ? "white" : "teal"} />
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

      <main className={cn("mx-auto max-w-md px-5 pb-32 lg:pb-16", width)}>
        {error && !me && (
          <div className="mt-16 space-y-4">
            <Notice tone="error">{error}</Notice>
            <Button variant="secondary" onClick={() => void refresh()} className="w-full">
              Try again
            </Button>
          </div>
        )}
        {!me && !error && <Loader label="Loading your account" />}
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
