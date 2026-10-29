import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope } from "next/font/google";
import { MIST } from "@/lib/palette";
import "./globals.css";

const body = Manrope({ subsets: ["latin"], variable: "--font-body", display: "swap" });

const description = "Send money home once and it lands divided: rent, school fees and upkeep, each paid on Arc with its own receipt.";

/**
 * Title, description and the link preview (opengraph-image.png and twitter-image.png beside this
 * file: the logo and "Send once. It lands divided." on the brand backdrop). Absolute URLs come from
 * APP_URL; mysplits.xyz when it isn't set at build time.
 */
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://mysplits.xyz"),
  title: { default: "Splits", template: "%s · Splits" },
  description,
  applicationName: "Splits",
  openGraph: { type: "website", siteName: "Splits", title: "Splits: send once, it lands divided", description, url: "/" },
  twitter: { card: "summary_large_image", title: "Splits: send once, it lands divided", description },
};

export const viewport = { themeColor: MIST };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={body.variable}>
      <body>{children}</body>
    </html>
  );
}
