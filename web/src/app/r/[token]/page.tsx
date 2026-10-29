import type { Metadata } from "next";
import Link from "next/link";
import { EnvBadge } from "@/components/app/env-badge";
import { Logo } from "@/components/app/logo";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Backdrop } from "@/components/app/backdrop";
import { ReceiptCard } from "@/components/app/receipt-card";
import { getCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { receiptByToken } from "@/server/services/receipts";

export const dynamic = "force-dynamic";

/** One lookup per request, shared by the page and its metadata. */
const load = cache(async (token: string) => {
  try {
    return await receiptByToken(await getCtx(), token);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
});

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const receipt = await load((await params).token);
  return {
    title: `Receipt: $${receipt.amount}`,
    description: `$${receipt.amount}${receipt.purpose ? ` for ${receipt.purpose}` : ""}, paid on ${receipt.network === "arc" ? "Arc" : "Arc Testnet"}.`,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * A recipient's receipt, open to anyone with the link and to nobody else (the token is the
 * permission). It shows that recipient's part only.
 */
export default async function ReceiptPage({ params }: Props) {
  const receipt = await load((await params).token);
  return (
    <div className="min-h-screen">
      <Backdrop className="print:hidden" />
      <header className="mx-auto flex max-w-md items-center justify-between gap-3 px-5 pt-5 pb-2">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Logo />
        </Link>
        {(receipt.simulated || receipt.network === "arc-testnet") && (
          <EnvBadge mode={receipt.simulated ? "preview" : "testnet"} />
        )}
      </header>
      <main className="mx-auto max-w-md px-5 pb-16">
        <ReceiptCard receipt={receipt} />
      </main>
    </div>
  );
}
