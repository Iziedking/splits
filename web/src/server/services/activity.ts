import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Ctx } from "../context";
import { transfers, users } from "../db/schema";
import { formatUsdc } from "../domain/money";
import { transferView } from "../views";
import { transfersFor } from "./transfers";
import { mainWallet, type User } from "./users";

export type ReceivedItem = {
  txHash: string;
  amount: string;
  /** The sending address. */
  from: string;
  /** The sender's email when the money came through a Splits payment. */
  fromLabel: string | null;
  /** A Splits payment, the demo card's top-up, or anything else that reached the address. */
  source: "splits" | "topup" | "external";
  purpose: string | null;
  at: string;
  explorerUrl: string | null;
};

const RECEIVED_UNAVAILABLE = "Couldn't load received payments. Try again.";

/** What you sent and what you received, newest first. Received comes from the wallet provider. */
export async function activityFor(ctx: Ctx, user: User) {
  const sent = (await transfersFor(ctx, user.id, 30))
    .filter((t) => t.status !== "awaiting_confirmation" && t.status !== "cancelled")
    .map((t) => transferView(ctx, t));

  const wallet = await mainWallet(ctx, user.id);
  if (!wallet) return { sent, received: [] as ReceivedItem[], receivedError: null as string | null };

  let inbound;
  try {
    inbound = await ctx.wallets.listInbound(wallet.providerWalletId, 30);
  } catch (err) {
    // Never show a partial list as if it were complete: sent items stay, received is marked unavailable.
    console.error("[activity] inbound list failed", err);
    return { sent, received: [] as ReceivedItem[], receivedError: RECEIVED_UNAVAILABLE as string | null };
  }

  // Money that came through our own payments gets its label and sender attached.
  const hashes = inbound.map((i) => i.txHash);
  const ours = hashes.length
    ? await ctx.db
        .select({ t: transfers, payer: users.email })
        .from(transfers)
        .innerJoin(users, eq(users.id, transfers.payerUserId))
        .where(and(isNotNull(transfers.txHash), inArray(transfers.txHash, hashes)))
    : [];
  const me = wallet.address.toLowerCase();
  const received: ReceivedItem[] = inbound.map((i) => {
    const match = ours.find((o) => o.t.txHash?.toLowerCase() === i.txHash.toLowerCase());
    const leg = match?.t.expected.find((l) => l.address.toLowerCase() === me);
    const topUp = !match && i.from.toLowerCase() === ctx.treasuryAddress.toLowerCase();
    return {
      txHash: i.txHash,
      amount: formatUsdc(i.amount),
      from: i.from,
      fromLabel: match?.payer ?? (topUp ? "Demo card top-up" : null),
      source: match ? "splits" : topUp ? "topup" : "external",
      purpose: leg?.purpose ?? null,
      at: i.at.toISOString(),
      explorerUrl: ctx.mode === "live" ? `${ctx.explorerUrl}/tx/${i.txHash}` : null,
    };
  });
  return { sent, received, receivedError: null as string | null };
}
