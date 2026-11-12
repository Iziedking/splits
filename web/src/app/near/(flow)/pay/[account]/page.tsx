import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PayFlow } from "@/components/near/pay-flow";
import { checkoutFor } from "@/lib/near/checkout";
import { isAccountId, normaliseAccount } from "@/lib/near/payment";

type Props = { params: Promise<{ account: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Pay ${normaliseAccount(decodeURIComponent((await params).account))}` };
}

export default async function NearPayPage({ params }: Props) {
  const owner = normaliseAccount(decodeURIComponent((await params).account));
  if (!isAccountId(owner)) notFound();
  return <PayFlow owner={owner} checkout={checkoutFor(owner)} />;
}
