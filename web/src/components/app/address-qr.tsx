"use client";

import QRCode from "qrcode";
import * as React from "react";
import { INK, WHITE } from "@/lib/palette";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A Split tag's page on this app, e.g. https://mysplits.xyz/@ada. */
const TAG_PAGE = /^https?:\/\/[a-z0-9.:-]+\/@[a-z0-9_]{3,20}$/i;

/** Only our own validated values are drawn, so the SVG string is safe to render. */
export const qrValueOk = (value: string) => ADDRESS.test(value) || TAG_PAGE.test(value);

/** A QR code drawn in ink: an account address, or the link to a Split tag's page. */
export function Qr({ value, size = 184, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    if (!qrValueOk(value)) return;
    void QRCode.toString(value, { type: "svg", margin: 1, color: { dark: INK, light: WHITE } }).then((out) => {
      if (live) setSvg(out);
    });
    return () => {
      live = false;
    };
  }, [value]);

  if (!qrValueOk(value)) return null;
  return (
    <div
      role="img"
      aria-label={label}
      className="overflow-hidden rounded-sm bg-white p-2 ring-1 ring-border [&_svg]:h-full [&_svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

/** A QR code for the account address, drawn in ink. */
export function AddressQr({ address, size = 184 }: { address: string; size?: number }) {
  return <Qr value={address} size={size} label="QR code of your account address" />;
}
