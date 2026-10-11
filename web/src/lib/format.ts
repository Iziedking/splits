import type { TransferView } from "./api";

/** "Landlord" -> "LA", "Mama Ngozi" -> "MN". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** Adds USDC decimal strings exactly, by working in 6-decimal integer units. */
export function addUsdc(values: string[]): string {
  let total = 0n;
  for (const v of values) {
    const [whole = "0", fraction = ""] = v.replace(/,/g, "").split(".");
    total += BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  }
  const whole = total / 1_000_000n;
  let fraction = (total % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${whole}.${fraction}`;
}

/** Total settled through one split in the current calendar month (UTC), as a USDC string. */
export function sentThisMonth(transfers: TransferView[], splitId: string, now = new Date()): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return addUsdc(
    transfers
      .filter((t) => t.splitId === splitId && t.status === "settled" && t.createdAt.startsWith(month))
      .map((t) => t.amount),
  );
}

export const STATUS_LABEL: Record<string, string> = {
  awaiting_confirmation: "Waiting for you to confirm",
  confirmed: "Starting",
  funding: "Topping up from your card",
  approving: "Getting ready to pay",
  sending: "Splitting and paying out",
  verifying: "Checking the receipt",
  settled: "Delivered",
  failed: "Not sent",
  cancelled: "Cancelled",
};

export function isFinal(status: string): boolean {
  return status === "settled" || status === "failed" || status === "cancelled";
}

/** Percent typed by a person ("33.3") into basis points, or null if it isn't a valid share. */
export function percentToBps(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value.trim())) return null;
  const bps = Math.round(Number(value) * 100);
  return bps > 0 && bps <= 10_000 ? bps : null;
}

/** "ada.obi@example.com" -> "Ada". Accounts have no names yet, so the greeting uses the email. */
export function greetingName(email: string): string {
  const word = (email.split("@")[0] ?? "").split(/[._+\-\d]+/).find(Boolean) ?? "there";
  return word.charAt(0).toUpperCase() + word.slice(1);
}
