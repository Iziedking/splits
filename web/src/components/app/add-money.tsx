"use client";

import { CreditCard, X } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import * as React from "react";
import { CopyAddress } from "@/components/app/copy-address";
import { Notice } from "@/components/ui/field";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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

/**
 * Two ways to put money in: send USDC on Arc to your own address (real), or the capped demo card
 * (simulated card, real USDC from the app's float). Rises from the bottom on a phone.
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

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="add-money-title"
      className="mx-auto mt-auto mb-0 w-full max-w-md rounded-t-[24px] bg-card p-0 text-card-foreground shadow-[0_24px_60px_-12px_rgb(14_28_43/0.35)] backdrop:bg-[#0e1c2b]/40 backdrop:backdrop-blur-[4px] open:motion-safe:animate-[rise_300ms_cubic-bezier(0.22,1,0.36,1)] sm:my-auto sm:w-[calc(100%-2rem)] sm:rounded-[24px] sm:open:motion-safe:animate-[pop_320ms_cubic-bezier(0.34,1.4,0.64,1)]"
    >
      <div className="p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-4">
          <h2 id="add-money-title" className="text-2xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="-m-2 rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <section aria-labelledby="deposit-heading" className="mt-5">
          <h3 id="deposit-heading" className="font-semibold">
            Your Splits address
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Share it, or your email if they use Splits. USDC sent here lands in your balance.
          </p>
          <div className="mt-3 flex items-center gap-4">
            <AddressQr address={address} size={128} />
            <div className="min-w-0 space-y-2">
              <code className="block text-sm break-all text-muted-foreground">{address}</code>
              <CopyAddress address={address} tone="dark" />
            </div>
          </div>
          <Notice className="mt-4">
            Send only USDC on {network === "arc" ? "Arc" : "Arc Testnet"}. Other networks or tokens can&apos;t be
            recovered here.
          </Notice>
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
      </div>
    </dialog>
  );
}
