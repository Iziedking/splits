"use client";

import { Home, Info, LifeBuoy, LogOut, Menu, PanelsTopLeft, Settings, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSignOut } from "@/components/app/sign-out";
import { cn } from "@/lib/utils";

const TOP: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/history", label: "History", icon: PanelsTopLeft },
  { href: "/about", label: "About", icon: Info },
  { href: "/help", label: "Help", icon: LifeBuoy },
];

/**
 * The desktop navigation (UI_BRIEF.md v5, frame "MacBook Air - 3"): a teal rail of icons, Home,
 * Profile, History and About at the top, Settings and Sign out at the bottom. The menu button opens
 * it to show labels; closed, each icon names itself on hover and focus. Phones keep the floating nav.
 *
 * Closed, it is the frame's brand teal: white icons on it pass the 3:1 contrast graphics need.
 * Open, labels are text, so it darkens to the pill fill (--primary-fill) where small white text reads at 5:1.
 */
export function SideRail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { signOut, signingOut, overlay } = useSignOut();
  const current = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const item = cn(
    "group relative flex min-h-12 items-center gap-3 rounded-md text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:outline-none",
    open ? "w-full px-4 focus-visible:ring-offset-primary-fill" : "w-12 justify-center focus-visible:ring-offset-primary",
  );
  const label = (text: string) =>
    open ? (
      <span>{text}</span>
    ) : (
      <>
        <span className="sr-only">{text}</span>
        {/* Closed: the name appears beside the icon on hover and keyboard focus. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full z-40 ml-3 rounded-lg bg-foreground px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {text}
        </span>
      </>
    );

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col py-6 text-white transition-[width,background-color] duration-200 lg:flex",
        open ? "w-56 items-stretch bg-primary-fill px-4" : "w-20 items-center bg-primary",
      )}
    >
      <div className={cn("flex items-center gap-1", !open && "justify-center")}>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} className={cn(item, open && "w-auto")}>
          <Menu className="h-5 w-5 shrink-0" aria-hidden="true" />
        </button>
        {open && (
          <Link href="/" className="inline-flex min-h-11 items-center rounded-lg px-1 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-white.svg" alt="Splits home" className="h-6 w-auto" />
          </Link>
        )}
      </div>

      <nav aria-label="Main" className={cn("mt-10 flex flex-col gap-2", !open && "items-center")}>
        {TOP.map(({ href, label: text, icon: Icon }) => (
          <Link key={href} href={href} aria-current={current(href) ? "page" : undefined} className={cn(item, "aria-[current=page]:bg-white aria-[current=page]:text-primary-fill")}>
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {label(text)}
          </Link>
        ))}
      </nav>

      <div className={cn("mt-auto flex flex-col gap-2", !open && "items-center")}>
        <Link href="/settings" aria-current={current("/settings") ? "page" : undefined} className={cn(item, "aria-[current=page]:bg-white aria-[current=page]:text-primary-fill")}>
          <Settings className="h-5 w-5 shrink-0" aria-hidden="true" />
          {label("Settings")}
        </Link>
        <button type="button" onClick={() => void signOut()} disabled={signingOut} className={item}>
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          {label("Sign out")}
        </button>
      </div>
      {overlay}
    </aside>
  );
}
