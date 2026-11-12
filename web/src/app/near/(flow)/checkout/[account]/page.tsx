import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutFlow } from "@/components/near/checkout-flow";
import { CHECKOUT, checkoutFor } from "@/lib/near/checkout";
import { isAccountId, normaliseAccount } from "@/lib/near/payment";

type Props = { params: Promise<{ account: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Pay ${normaliseAccount(decodeURIComponent((await params).account))} from any wallet` };
}

/** Split Checkout: pay a saved split on NEAR mainnet from another chain, through NEAR Intents. */
export default async function NearCheckoutPage({ params }: Props) {
  const owner = normaliseAccount(decodeURIComponent((await params).account));
  if (!isAccountId(owner) || !checkoutFor(owner)) notFound();
  return <CheckoutFlow owner={owner} router={CHECKOUT.router} />;
}
