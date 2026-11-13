import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Manrope } from "next/font/google";
import { MIST } from "@/lib/palette";
import { nearHosts } from "@/lib/near/config";
import { nearMetadata } from "@/lib/near/meta";
import { REWRITE_HEADER } from "@/proxy";
import "./globals.css";

const body = Manrope({ subsets: ["latin"], variable: "--font-body", display: "swap" });

const description = "Send money home once and it lands divided: rent, school fees and upkeep, each paid on Arc with its own receipt.";

const image = { url: "/og/arc.png", width: 1200, height: 630, alt: "The Splits logo with the line: Send once. It lands divided." };

/**
 * Title, description and the link preview (public/og/arc.png: the logo and "Send once. It lands
 * divided." on the brand backdrop). Absolute URLs come from APP_URL; mysplits.xyz when it isn't set.
 */
const arcMetadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://mysplits.xyz"),
  title: { default: "Splits", template: "%s · Splits" },
  description,
  applicationName: "Splits",
  openGraph: { type: "website", siteName: "Splits", title: "Splits: send once, it lands divided", description, url: "/", images: [image] },
  twitter: { card: "summary_large_image", title: "Splits: send once, it lands divided", description, images: [image] },
};

/**
 * One server answers mysplits.xyz and near.mysplits.xyz, so the link preview follows the host:
 * every page on the NEAR host, its 404s included, describes the NEAR product.
 */
export async function generateMetadata(): Promise<Metadata> {
  const hosts = nearHosts();
  if (hosts.length === 0) return arcMetadata;
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.split(":")[0]!.trim().toLowerCase();
  return hosts.includes(host) || h.has(REWRITE_HEADER) ? nearMetadata() : arcMetadata;
}

export const viewport = { themeColor: MIST };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // NEAR mode marks <html> before first paint once its splash has been seen (components/near/splash.tsx).
    <html lang="en" className={body.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
