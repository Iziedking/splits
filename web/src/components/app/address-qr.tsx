"use client";

import QRCode from "qrcode";
import * as React from "react";
import { INK, WHITE } from "@/lib/palette";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A QR code for the account address, drawn in ink. */
export function AddressQr({ address, size = 184 }: { address: string; size?: number }) {
  const [svg, setSvg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    // Only ever our own, validated address goes in, so the SVG string is safe to render.
    if (!ADDRESS.test(address)) return;
    void QRCode.toString(address, { type: "svg", margin: 1, color: { dark: INK, light: WHITE } }).then((out) => {
      if (live) setSvg(out);
    });
    return () => {
      live = false;
    };
  }, [address]);

  return (
    <div
      role="img"
      aria-label="QR code of your account address"
      className="overflow-hidden rounded-sm bg-white p-2 ring-1 ring-border [&_svg]:h-full [&_svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
