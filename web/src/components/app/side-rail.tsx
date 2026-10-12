"use client";

import { Info, LogOut, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon };

const itemClass =
  "flex w-16 flex-col items-center gap-1 rounded-2xl py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A7A73] focus-visible:outline-none";

/**
 * The desktop navigation (UI_BRIEF.md v5, frame "MacBook Air - 3"): a teal rail down the left edge
 * with the same places as the phone's floating nav, plus About and Sign out at the bottom.
 * Only shown from the `lg` breakpoint; phones keep the floating nav.
 */
export function SideRail({ items, isCurrent }: { items: readonly Item[]; isCurrent: (href: string) => boolean }) {
  const router = useRouter();

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
  }

  return (
    // A shade darker than the brand teal so the small white labels read at 5:1 (WCAG AA).
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-24 flex-col items-center bg-[#0A7A73] py-6 text-white lg:flex">
      {/* The wordmark stands in for the logo until it is ready. */}
      <Link
        href="/home"
        className="rounded-xl px-2 py-1 text-lg font-extrabold tracking-tight focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A7A73] focus-visible:outline-none"
      >
        Splits
      </Link>
      <nav aria-label="Main" className="mt-10 flex flex-col items-center gap-2">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent(href) ? "page" : undefined}
            className={cn(itemClass, "aria-[current=page]:bg-white aria-[current=page]:text-[#0A7A73]")}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2">
        <Link href="/about" className={itemClass}>
          <Info className="h-5 w-5" aria-hidden="true" />
          About
        </Link>
        <button type="button" onClick={() => void signOut()} className={itemClass}>
          <LogOut className="h-5 w-5" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
