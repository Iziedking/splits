"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Sheet } from "@/components/app/sheet";
import { api, type NotificationsView } from "@/lib/api";
import { cn } from "@/lib/utils";

const POLL_MS = 15_000;
const TOAST_MS = 5_000;
type Item = NotificationsView["items"][number];

function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * What happened to your money: deposits arriving and ready, payments landed or failed, money
 * received. Checks every 15 seconds while the tab is visible; anything new also shows as a toast.
 */
export function NotificationBell() {
  const [view, setView] = React.useState<NotificationsView | null>(null);
  const [open, setOpen] = React.useState(false);
  const [toast, setToast] = React.useState<Item | null>(null);
  const seen = React.useRef<Set<string> | null>(null);
  const [clearing, setClearing] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const next = await api<NotificationsView>("/api/notifications");
      const known = seen.current;
      // The first load is history, not news: only later arrivals become toasts.
      if (known) {
        const fresh = next.items.find((i) => !known.has(i.id) && !i.read);
        if (fresh) setToast(fresh);
      }
      seen.current = new Set(next.items.map((i) => i.id));
      setView(next);
    } catch {
      // Signed out or offline: the bell just stays as it was.
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  React.useEffect(() => {
    if (open && view && view.unread > 0) {
      void api("/api/notifications/read", { method: "POST" }).then(load);
    }
  }, [open, view, load]);

  async function clearAll() {
    setClearing(true);
    try {
      await api("/api/notifications/clear", { method: "POST" });
      await load();
    } finally {
      setClearing(false);
    }
  }

  const unread = view?.unread ?? 0;
  const groups: [string, Item[]][] = [];
  for (const item of view?.items ?? []) {
    const label = dayLabel(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-white/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-fill px-1 text-xs leading-none font-bold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        actions={
          groups.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              disabled={clearing}
              className="-my-1.5 inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-primary-text hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
            >
              Clear all
            </button>
          )
        }
      >
        {groups.length === 0 ? (
          <p className="mt-6 text-muted-foreground">You&apos;re all caught up. Money you send, receive and deposit shows up here as it happens.</p>
        ) : (
          groups.map(([label, items]) => (
            <section key={label} aria-label={label} className="mt-5">
              <h3 className="text-xs font-semibold text-muted-foreground">{label}</h3>
              <ul className="mt-2 space-y-2">
                {items.map((n) => {
                  const body = (
                    <>
                      <span className="flex items-start gap-2">
                        {!n.read && (
                          <>
                            <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                            <span className="sr-only">New: </span>
                          </>
                        )}
                        <span className="min-w-0">
                          <span className="block font-semibold">{n.title}</span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {n.href ? (
                        <Link
                          href={n.href}
                          onClick={() => setOpen(false)}
                          className="block rounded-md bg-white/70 p-3.5 ring-1 ring-border hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="rounded-md bg-white/70 p-3.5 ring-1 ring-border">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </Sheet>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
        {toast && (
          <button
            type="button"
            onClick={() => {
              setToast(null);
              setOpen(true);
            }}
            className={cn(
              "pointer-events-auto w-full max-w-sm rounded-lg bg-foreground px-4 py-3 text-left text-sm text-background shadow-toast",
              "motion-safe:animate-[pop_320ms_cubic-bezier(0.34,1.4,0.64,1)]",
            )}
          >
            <span className="block font-semibold">{toast.title}</span>
            <span className="block text-background/80">{toast.body}</span>
          </button>
        )}
      </div>
    </>
  );
}
