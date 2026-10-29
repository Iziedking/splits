import { and, eq, gt, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Ctx } from "../context";
import { transfers, users, type TransferStatus } from "../db/schema";
import { formatUsdc } from "../domain/money";
import { forbidden } from "../errors";

export type Sender = { userId?: string | null; address?: string | null; email?: string | null };
export type SenderClass = "account" | "visitor";
export type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

const DAY_MS = 24 * 60 * 60_000;
const COUNTED: TransferStatus[] = ["confirmed", "funding", "approving", "sending", "verifying", "settled"];

/** Serialises every limit check with card top-ups, so two payments can't both squeeze under. */
export function withSendLimitLock<T>(ctx: Ctx, run: (tx: Tx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('splits:funding'))`);
    return run(tx);
  });
}

/**
 * Each way a sender is known, as a condition on transfers, and whether open reservations count. An
 * unpaid reservation counts only against the wallet that made it: anyone can type an email, so a
 * reservation naming someone's email must not use up their limit before any money has moved.
 */
function identities(sender: Sender): { who: SQL; reservations: boolean }[] {
  const out: { who: SQL; reservations: boolean }[] = [];
  if (sender.userId) out.push({ who: eq(transfers.payerUserId, sender.userId), reservations: true });
  if (sender.address) {
    out.push({ who: sql`lower(${transfers.payerAddress}) = ${sender.address.toLowerCase()}`, reservations: true });
  }
  if (sender.email) {
    const email = sender.email.trim().toLowerCase();
    out.push({
      who: or(
        eq(transfers.visitorEmail, email),
        sql`${transfers.payerUserId} in (select ${users.id} from ${users} where ${users.email} = ${email})`,
      )!,
      reservations: false,
    });
  }
  return out;
}

/**
 * The KYC stand-in: no payment over the per-payment limit, and no sender over the daily limit in
 * any rolling 24 hours, by any of the ways they are known. Throws SEND_LIMIT with what is left.
 */
export async function checkSendLimit(db: Ctx["db"] | Tx, ctx: Ctx, sender: Sender, cls: SenderClass, amount: bigint) {
  const perPayment = cls === "visitor" ? ctx.limits.visitorPerPayment : ctx.limits.sendPerPayment;
  const daily = cls === "visitor" ? ctx.limits.visitorDaily : ctx.limits.sendDaily;
  if (amount > perPayment) {
    throw forbidden(
      "SEND_LIMIT",
      `Payments over $${formatUsdc(perPayment)}, including the Splits fee, need identity verification, which Splits does not offer yet. Lower the total to continue.`,
    );
  }
  const now = ctx.now();
  const since = new Date(now.getTime() - DAY_MS);
  for (const { who, reservations } of identities(sender)) {
    const [row] = await db
      .select({
        total: sql<string>`coalesce(sum(${transfers.amount}::numeric + ${transfers.feeAmount}::numeric), 0)::text`,
        // When the first counted payment stops counting: a day after it was made, or sooner for a
        // reservation that expires first. Epoch seconds, so no date-string parsing is involved.
        frees: sql<string | null>`extract(epoch from min(case when ${transfers.status} = 'awaiting_wallet' then least(${transfers.expiresAt}, ${transfers.createdAt} + interval '24 hours') else ${transfers.createdAt} + interval '24 hours' end))::text`,
      })
      .from(transfers)
      .where(
        and(
          who,
          ne(transfers.kind, "auto"),
          gt(transfers.createdAt, since),
          reservations
            ? or(inArray(transfers.status, COUNTED), and(eq(transfers.status, "awaiting_wallet"), gt(transfers.expiresAt, now)))
            : inArray(transfers.status, COUNTED),
        ),
      );
    const used = BigInt(row?.total ?? "0");
    if (used + amount > daily) {
      const left = daily > used ? daily - used : 0n;
      const frees = row?.frees ? new Date(Math.round(Number(row.frees) * 1000)) : new Date(now.getTime() + DAY_MS);
      throw forbidden(
        "SEND_LIMIT",
        `You can send $${formatUsdc(left)} more today, including the Splits fee. More frees up at ${frees.toISOString().slice(11, 16)} UTC.`,
      );
    }
  }
}
