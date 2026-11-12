import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BuyFlow } from "@/components/near/buy-flow";
import { decodeButton } from "@/lib/near/button";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

type Props = { searchParams: Promise<{ c?: string; back?: string }> };

/** Where a "Pay with Splits" button lands. The setup rides in the link (lib/near/button.ts). */
export default async function NearBuyPage({ searchParams }: Props) {
  const { c, back } = await searchParams;
  const config = c ? decodeButton(c) : null;
  if (!config) notFound();
  // Only a page on this site can be the way back, never an outside address.
  const ret = back === "/near/shop" ? { href: back, label: "Back to the shop" } : null;
  return <BuyFlow config={config} back={ret} />;
}
