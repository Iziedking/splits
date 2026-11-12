import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Backdrop } from "@/components/app/backdrop";
import { NearSplash } from "@/components/near/splash";
import { NearWalletProvider } from "@/components/near/wallet";
import { nearEnabled } from "@/lib/near/config";

// Account names are addresses on NEAR, so they are set in a mono that reads clearly at small sizes.
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Splits on NEAR", template: "%s · Splits on NEAR" },
  description: "One stablecoin payment on NEAR, divided between named accounts, with a purpose on every part.",
};

// Read NEAR_ENABLED at request time, so the same image serves mysplits.xyz (off) and near.mysplits.xyz (on).
export const dynamic = "force-dynamic";

export default function NearLayout({ children }: { children: ReactNode }) {
  if (!nearEnabled()) notFound();
  return (
    <NearWalletProvider>
      <NearSplash />
      <Backdrop />
      <div className={mono.variable}>{children}</div>
    </NearWalletProvider>
  );
}
