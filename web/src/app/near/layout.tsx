import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Backdrop } from "@/components/app/backdrop";
import { NearShell } from "@/components/near/shell";
import { NearWalletProvider } from "@/components/near/wallet";
import { nearEnabled } from "@/lib/near/config";

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
      <Backdrop />
      <NearShell>{children}</NearShell>
    </NearWalletProvider>
  );
}
