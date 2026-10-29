"use client";

import { Check, CreditCard, X } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import * as React from "react";
import { CopyAddress } from "@/components/app/copy-address";
import { Notice } from "@/components/ui/field";
import { api, type DepositView } from "@/lib/api";
import { cn } from "@/lib/utils";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const POLL_MS = 4_000;
/** A finished deposit stays on the status line this long, then it goes back to waiting. */
const SHOW_READY_MS = 10 * 60_000;

/** A QR code for the wallet address, drawn in ink. */
export function AddressQr({ address, size = 184 }: { address: string; size?: number }) {
  const [svg, setSvg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    // Only ever our own, validated address goes in, so the SVG string is safe to render.
    if (!ADDRESS.test(address)) return;
    void QRCode.toString(address, { type: "svg", margin: 1, color: { dark: "#0E1C2B", light: "#FFFFFF" } }).then((out) => {
      if (live) setSvg(out);
    });
    return () => {
      live = false;
    };
  }, [address]);

  return (
    <div
      role="img"
      aria-label="QR code of your wallet address"
      className="overflow-hidden rounded-[14px] bg-white p-2 ring-1 ring-border [&_svg]:h-full [&_svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

type Tab = "evm" | "solana";

/**
 * One address for Arc and every chain Splits accepts (named, never "any chain"). The person's Splits address is the same on Arc and on every EVM chain
 * Splits accepts, so one QR and one copy button cover them all; money sent from another chain is
 * moved to Arc by itself and the status line follows it. Rises from the bottom on a phone.
 */
export function AddMoney({
  title = "Add money",
  address,
  network,
  open,
  onClose,
}: {
  title?: string;
  address: string;
  network: "arc" | "arc-testnet";
  open: boolean;
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [tab, setTab] = React.useState<Tab>("evm");
  const [view, setView] = React.useState<DepositView | null>(null);
  const [settingUp, setSettingUp] = React.useState(false);
  const [about, setAbout] = React.useState<string | null>(null);
  const [simulating, setSimulating] = React.useState(false);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

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
          const ready = await api<DepositView>("/api/deposits", { method: "POST" });
          if (live) setView(ready);
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

  const chains = view?.chains ?? [];
  const arcName = network === "arc" ? "Arc" : "Arc Testnet";
  const notes: Record<string, string> = {
    arc: `${arcName}: arrives straight away, any amount.`,
    ...Object.fromEntries(
      chains.map((c) => [
        c.key,
        `${c.name}: $${c.min} minimum${c.key === "eth" ? ", gas is high there" : ""}. Arrives ${c.fast ? "in about a minute" : "in a few minutes"}.`,
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
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="add-money-title"
      className="mx-auto mt-auto mb-0 w-full max-w-md rounded-t-[24px] bg-card p-0 text-card-foreground shadow-[0_24px_60px_-12px_rgb(14_28_43/0.35)] backdrop:bg-[#0e1c2b]/40 backdrop:backdrop-blur-[4px] open:motion-safe:animate-[rise_300ms_cubic-bezier(0.22,1,0.36,1)] sm:my-auto sm:w-[calc(100%-2rem)] sm:rounded-[24px] sm:open:motion-safe:animate-[pop_320ms_cubic-bezier(0.34,1.4,0.64,1)]"
    >
      <div className="max-h-[90dvh] overflow-y-auto p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="add-money-title" className="text-2xl font-bold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              One address for {[arcName, ...chains.map((c) => c.name)].join(", ").replace(/, ([^,]*)$/, " and $1")}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="-m-2 rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div role="tablist" aria-label="Where you send from" className="mt-5 grid grid-cols-2 rounded-full bg-muted/60 p-1">
          {(
            [
              ["evm", "EVM chains"],
              ["solana", "Solana"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              onClick={() => setTab(key)}
              className={cn(
                "min-h-11 rounded-full px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                tab === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "evm" ? (
          <section id="panel-evm" role="tabpanel" aria-labelledby="tab-evm" className="mt-5">
            <div className="flex items-center gap-4">
              <AddressQr address={address} size={128} />
              <div className="min-w-0 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Your address</p>
                <code className="block text-sm break-all text-foreground">{address}</code>
                <CopyAddress address={address} tone="dark" />
              </div>
            </div>

            <p className="mt-5 text-sm font-semibold">Send from</p>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Chains this address accepts">
              {[{ key: "arc", name: arcName }, ...chains].map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    aria-pressed={about === c.key}
                    onClick={() => setAbout(about === c.key ? null : c.key)}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium ring-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      about === c.key ? "bg-primary/10 text-primary ring-primary/50" : "bg-white/70 ring-border hover:ring-primary/40",
                    )}
                  >
                    <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", c.key === "arc" ? "bg-primary" : "bg-foreground/50")} />
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
            {about && <p className="mt-2 text-sm text-muted-foreground">{notes[about]}</p>}

            <Notice className="mt-4">
              Send USDC only, and only from the networks above. Other tokens, or USDC from any other network, may not
              reach your balance.
            </Notice>

            <DepositStatus view={view} settingUp={settingUp} />

            {view?.preview && chains.length > 0 && (
              <button
                type="button"
                onClick={() => void simulate()}
                disabled={simulating}
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4 disabled:opacity-50"
              >
                Simulate $5.00 from {chains[0]!.name} (preview)
              </button>
            )}
            {network === "arc-testnet" && (
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4"
              >
                Get testnet USDC
              </a>
            )}
          </section>
        ) : (
          <section id="panel-solana" role="tabpanel" aria-labelledby="tab-solana" className="mt-6">
            <p className="font-semibold">Solana is not supported yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              For now, send USDC from an EVM chain like Base or Arbitrum. It arrives in your balance by itself.
            </p>
          </section>
        )}

        {view?.demoCard && (
          <section aria-labelledby="card-heading" className="mt-6 border-t border-border pt-5">
            <h3 id="card-heading" className="font-semibold">
              Demo card
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A simulated card that releases a small amount of real USDC so you can try Splits. Limited per day.
            </p>
            <Link
              href="/pay?fund=card"
              className="mt-3 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-white/70 px-6 text-[15px] font-semibold text-primary ring-1 ring-primary/70 hover:bg-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              Pay with the demo card
            </Link>
          </section>
        )}
      </div>
    </dialog>
  );
}

/** The latest deposit, in plain words; announced to screen readers as it changes. */
function DepositStatus({ view, settingUp }: { view: DepositView | null; settingUp: boolean }) {
  const d = view?.latest;
  const recent = d ? Date.now() - new Date(d.at).getTime() < SHOW_READY_MS : false;
  let text = "Waiting for your deposit…";
  let tone: "wait" | "move" | "done" = "wait";
  if (settingUp) text = "Setting up your address…";
  else if (d && d.stuck) {
    text = `Your $${d.amount} is safe on ${d.chainName}. Moving it to Arc is taking longer than usual; Splits keeps trying.`;
    tone = "move";
  } else if (d && d.status === "waiting") {
    const min = view?.chains.find((c) => c.key === d.chain)?.min ?? "1.00";
    text = `$${d.amount} arrived on ${d.chainName}. It moves to Arc once you have $${min} there.`;
  } else if (d && (d.status === "detected" || d.status === "moving")) {
    text = `$${d.amount} arrived on ${d.chainName}, moving to Arc…`;
    tone = "move";
  } else if (d && d.status === "ready" && recent) {
    text = `Ready: $${d.minted ?? d.amount} is in your balance`;
    tone = "done";
  }
  return (
    <p role="status" aria-live="polite" className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
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
