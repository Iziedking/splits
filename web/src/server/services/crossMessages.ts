import type { CrossPayment, transfers } from "../db/schema";
import { formatUsdc } from "../domain/money";

type Transfer = typeof transfers.$inferSelect;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Every message a cross-chain payer can see after the burn. Tests assert these exact strings. */
export const CROSS_TEXT = {
  waitingBurn: (chain: string) => `Confirm in your wallet to pay from ${chain}.`,
  burnReverted: (chain: string) => `The payment didn't leave ${chain}. Your USDC is still in your wallet. Only the network fee was spent.`,
  burnReplaced: (chain: string) => `This payment was replaced in your wallet and never left ${chain}.`,
  confirming: (chain: string) => `Waiting for Circle to confirm on ${chain}. You can close this page; this link shows the result later.`,
  slowRoute: () => "Circle's fee went up while you paid, so this is taking the standard route. It lands in about 15 minutes. Nothing to do.",
  attention: () => "Circle hasn't confirmed this yet. Your money is safe in transit and finishes when Circle confirms. We're watching it.",
  arriving: () => "Arriving on Arc…",
  paid: (feeBack: bigint) => (feeBack > 0n ? `Paid on Arc. $${formatUsdc(feeBack)} unused fee went back to your Arc address.` : "Paid on Arc."),
  refunded: (amount: bigint, payer: string) =>
    `One recipient couldn't receive USDC on Arc, so nobody was paid. The full $${formatUsdc(amount)} went back to your address ${short(payer)} on Arc.`,
  owed: () => "Your refund is held for your wallet. Claim it here.",
  expired: () => "This payment link expired before anything left your wallet. Start again.",
  mismatch: () => "That transaction isn't the payment this link set up. Flagged for review.",
} as const;

/**
 * The live screen's state for a cross-chain payment: which of the four steps (Left <chain>,
 * Confirmed by Circle, Paid on Arc, Receipt checked) is done, and what to say.
 */
export function crossMessage(t: Transfer, cp: CrossPayment, chainName: string): { step: 0 | 1 | 2 | 3 | 4; tone: "info" | "warn" | "error" | "done"; text: string } {
  if (t.status === "settled") return { step: 4, tone: "done", text: CROSS_TEXT.paid(BigInt(cp.feeBack ?? "0")) };
  switch (cp.phase) {
    case "awaiting_burn":
      if (cp.lastError === "replaced") return { step: 0, tone: "error", text: CROSS_TEXT.burnReplaced(chainName) };
      if (cp.lastError === "reverted") return { step: 0, tone: "error", text: CROSS_TEXT.burnReverted(chainName) };
      return { step: 0, tone: "info", text: CROSS_TEXT.waitingBurn(chainName) };
    case "cancelled":
      return { step: 0, tone: "error", text: CROSS_TEXT.expired() };
    case "burned":
    case "attesting":
      if (cp.attentionAt) return { step: 1, tone: "warn", text: CROSS_TEXT.attention() };
      if (cp.slowRoute) return { step: 1, tone: "info", text: CROSS_TEXT.slowRoute() };
      return { step: 1, tone: "info", text: CROSS_TEXT.confirming(chainName) };
    case "relaying":
      return { step: 2, tone: cp.attentionAt ? "warn" : "info", text: CROSS_TEXT.arriving() };
    case "paid":
      return { step: 3, tone: "info", text: CROSS_TEXT.paid(BigInt(cp.feeBack ?? "0")) };
    case "refunded":
      if (cp.lastError === "burn mismatch") return { step: 1, tone: "error", text: CROSS_TEXT.mismatch() };
      return { step: 3, tone: "error", text: CROSS_TEXT.refunded(BigInt(cp.refundAmount ?? "0"), t.payerAddress) };
    case "owed":
      return { step: 3, tone: "error", text: CROSS_TEXT.owed() };
  }
}
