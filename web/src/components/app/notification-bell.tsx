"use client";

import { Bell, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
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
  const ref = React.useRef<HTMLDialogElement>(null);
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
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
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
          <span aria-hidden="true" className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby="notifications-title"
        className="mx-auto mt-auto mb-0 w-full max-w-md rounded-t-[24px] bg-card p-0 text-card-foreground shadow-[0_24px_60px_-12px_rgb(14_28_43/0.35)] backdrop:bg-[#0e1c2b]/40 backdrop:backdrop-blur-[4px] open:motion-safe:animate-[rise_300ms_cubic-bezier(0.22,1,0.36,1)] sm:my-auto sm:w-[calc(100%-2rem)] sm:rounded-[24px]"
      >
        <div className="max-h-[80dvh] overflow-y-auto p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-start gap-2">
            <h2 id="notifications-title" className="text-2xl font-bold">
              Notifications
            </h2>
            <span className="ml-auto" />
            {groups.length > 0 && (
              <button
                type="button"
                onClick={() => void clearAll()}
                disabled={clearing}
                className="-my-1 inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="-m-2 rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
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
                          {!n.read && <span aria-label="New" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
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
                            className="block rounded-[16px] bg-white/70 p-3.5 ring-1 ring-border hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {body}
                          </Link>
                        ) : (
                          <div className="rounded-[16px] bg-white/70 p-3.5 ring-1 ring-border">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </dialog>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
        {toast && (
          <button
            type="button"
            onClick={() => {
              setToast(null);
              setOpen(true);
            }}
            className={cn(
              "pointer-events-auto w-full max-w-sm rounded-[18px] bg-foreground px-4 py-3 text-left text-sm text-background shadow-[0_18px_40px_-14px_rgb(14_28_43/0.6)]",
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
