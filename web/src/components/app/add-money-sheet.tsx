"use client";

import { Check, ChevronRight, CreditCard, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AddressQr } from "@/components/app/address-qr";
import { BackLink } from "@/components/app/back-link";
import { CopyAddress } from "@/components/app/copy-address";
import { MoneyNotice } from "@/components/app/money-notice";
import { Sheet } from "@/components/app/sheet";
import { Notice } from "@/components/ui/field";
import { api, type DepositView } from "@/lib/api";
import { cn } from "@/lib/utils";

const POLL_MS = 4_000;
/** A finished deposit stays on the status line this long, then it goes back to waiting. */
const SHOW_READY_MS = 10 * 60_000;

/**
 * One way to add money. The list is data, so new methods (card, bank, per country) join it without
 * a layout change. A method with `panel` opens it inside the sheet; one with `href` leaves it.
 */
type Method = { key: string; title: string; detail: string; icon: React.ReactNode } & ({ panel: "crypto" } | { href: string });

function methodsFor(view: DepositView | null): Method[] {
  const methods: Method[] = [];
  if (view?.demoCard) {
    methods.push({
      key: "test-card",
      title: "Test card",
      detail: "Adds a small amount of real money so you can try Splits. No card is charged. Limited per day.",
      icon: <CreditCard className="h-5 w-5" aria-hidden="true" />,
      href: "/pay?fund=card",
    });
  }
  // Last, as the fallback rail: the people who choose it already hold digital dollars.
  methods.push({
    key: "crypto",
    title: "From a crypto wallet",
    detail: "Send digital dollars from a wallet or exchange you already use.",
    icon: <Wallet className="h-5 w-5" aria-hidden="true" />,
    panel: "crypto",
  });
  return methods;
}

/**
 * Add money: the ways in, as a list (fintech face WP5). Today the live one is a crypto wallet,
 * which opens the address, its QR and the networks it accepts. That panel is for people who chose
 * crypto, so it speaks their language; the list itself does not. Rises from the bottom on a phone.
 */
export function AddMoneySheet({
  address,
  network,
  open,
  onClose,
}: {
  address: string;
  network: "arc" | "arc-testnet";
  open: boolean;
  onClose: () => void;
}) {
  const [panel, setPanel] = React.useState<"list" | "crypto">("list");
  const [view, setView] = React.useState<DepositView | null>(null);
  const [settingUp, setSettingUp] = React.useState(false);
  /** Setting the address up on the other chains failed; Arc works regardless, and the next poll retries. */
  const [setupFailed, setSetupFailed] = React.useState(false);

  // While open: set the address up on every chain once, then follow the latest deposit.
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api<DepositView>("/api/deposits");
        if (!live) return;
        setView(next);
        if (!next.ready && next.chains.length > 0) {
          setSettingUp(true);
          try {
            const ready = await api<DepositView>("/api/deposits", { method: "POST" });
            if (live) {
              setView(ready);
              setSetupFailed(false);
            }
          } catch {
            if (live) setSetupFailed(true);
          }
        }
      } catch {
        // Keep the last view; the next poll tries again.
      } finally {
        if (live) setSettingUp(false);
      }
      if (live) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        setPanel("list");
        onClose();
      }}
      title="Add money"
      description={panel === "list" ? "Choose how to add money." : "From a crypto wallet"}
    >
      {panel === "list" ? (
        <ul className="mt-5 space-y-2">
          {methodsFor(view).map((m) => {
            const body = (
              <>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary-text">{m.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{m.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{m.detail}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </>
            );
            const row =
              "flex min-h-16 w-full items-center gap-3 rounded-md bg-white/70 p-3.5 text-left ring-1 ring-border hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
            return (
              <li key={m.key}>
                {"href" in m ? (
                  <Link href={m.href} className={row}>
                    {body}
                  </Link>
                ) : (
                  <button type="button" onClick={() => setPanel(m.panel)} className={row}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <CryptoPanel address={address} network={network} view={view} onBack={() => setPanel("list")} />
      )}

      <DepositStatus view={view} settingUp={settingUp} setupFailed={setupFailed} />
      <MoneyNotice className="mt-4" />
    </Sheet>
  );
}

/** The address, its QR and the networks it accepts, for someone sending from a crypto wallet. */
function CryptoPanel({ address, network, view, onBack }: { address: string; network: "arc" | "arc-testnet"; view: DepositView | null; onBack: () => void }) {
  const [about, setAbout] = React.useState<string | null>(null);
  const [simulating, setSimulating] = React.useState(false);
  const chains = view?.chains ?? [];
  const arcName = network === "arc" ? "Arc" : "Arc Testnet";
  const notes: Record<string, string> = {
    arc: `${arcName}: arrives straight away, any amount.`,
    ...Object.fromEntries(
      chains.map((c) => [
        c.key,
        `${c.name}: $${c.min} minimum${c.key === "eth" ? ", network fees are high there" : ""}. Arrives ${c.fast ? "in about a minute" : "in a few minutes"}.`,
      ]),
    ),
  };

  async function simulate() {
    setSimulating(true);
    try {
      await api("/api/demo/deposit", { body: { chain: chains[0]?.key ?? "base", amount: "5" } });
    } finally {
      setSimulating(false);
    }
  }

  return (
    <section data-crypto-path aria-label="From a crypto wallet" className="mt-3">
      <BackLink onClick={onBack} label="All ways to add money" />
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <AddressQr address={address} size={128} />
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Your account address</p>
          <code className="block text-sm break-all text-foreground">{address}</code>
          <CopyAddress address={address} tone="dark" />
        </div>
      </div>

      <p className="mt-5 text-sm font-semibold">Send from</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Networks this account accepts">
        {[{ key: "arc", name: arcName }, ...chains].map((c) => (
          <li key={c.key}>
            <button
              type="button"
              aria-pressed={about === c.key}
              onClick={() => setAbout(about === c.key ? null : c.key)}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium ring-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                about === c.key ? "bg-primary/10 text-primary-text ring-primary/50" : "bg-white/70 ring-border hover:ring-primary/40",
              )}
            >
              <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", c.key === "arc" ? "bg-primary" : "bg-foreground/50")} />
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      {about && <p className="mt-2 text-sm text-muted-foreground">{notes[about]}</p>}
      <p className="mt-2 text-sm text-muted-foreground">Other networks, Solana included, aren&apos;t supported.</p>

      <Notice className="mt-4">Only send USDC, and only from the networks listed. Anything else may be lost.</Notice>

      {view?.preview && chains.length > 0 && (
        <button
          type="button"
          onClick={() => void simulate()}
          disabled={simulating}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary-text underline underline-offset-4 disabled:opacity-50"
        >
          Add $5.00 of test money
        </button>
      )}
      {network === "arc-testnet" && (
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary-text underline underline-offset-4"
        >
          Get test money
        </a>
      )}
    </section>
  );
}

/** The latest deposit, in plain words; announced to screen readers as it changes. */
function DepositStatus({ view, settingUp, setupFailed }: { view: DepositView | null; settingUp: boolean; setupFailed: boolean }) {
  const d = view?.latest;
  const recent = d ? Date.now() - new Date(d.at).getTime() < SHOW_READY_MS : false;
  let text = "Waiting for money to arrive…";
  let tone: "wait" | "move" | "done" = "wait";
  if (settingUp) text = "Getting your account ready…";
  else if (setupFailed && !d) {
    text = "Your account isn't ready for every network yet. Splits keeps trying.";
    tone = "move";
  } else if (d && d.stuck) {
    text = `Your $${d.amount} is safe. Adding it to your balance is taking longer than usual; Splits keeps trying.`;
    tone = "move";
  } else if (d && d.status === "waiting") {
    const min = view?.chains.find((c) => c.key === d.chain)?.min ?? "1.00";
    text = `$${d.amount} arrived. It reaches your balance once at least $${min} has arrived.`;
  } else if (d && (d.status === "detected" || d.status === "moving")) {
    text = `$${d.amount} arrived, adding it to your balance…`;
    tone = "move";
  } else if (d && d.status === "ready" && recent) {
    text = `$${d.minted ?? d.amount} is in your balance`;
    tone = "done";
  }
  return (
    <p role="status" className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
      {tone === "done" ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone === "move" ? "bg-primary motion-safe:animate-pulse" : "bg-muted-foreground/60")}
        />
      )}
      <span className={cn(tone === "done" && "font-semibold text-foreground")}>{text}</span>
    </p>
  );
}
