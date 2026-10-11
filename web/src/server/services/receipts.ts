import { asc, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { receiptLinks as receiptLinksTable, transfers, users } from "../db/schema";
import { randomToken } from "../domain/ids";
import { notFound } from "../errors";
import { receiptView } from "../views";
import type { Transfer } from "./transfers";

/** 18 random bytes, base64url: 24 characters nobody can guess or walk through. */
const TOKEN = /^[A-Za-z0-9_-]{24}$/;

/**
 * The receipt links for a settled payment, one per recipient in leg order. Made the first time
 * they're asked for and the same ever after. Null until the payment has settled.
 */
export async function receiptLinks(ctx: Ctx, t: Transfer): Promise<string[] | null> {
  if (t.status !== "settled") return null;
  await ctx.db
    .insert(receiptLinksTable)
    .values(t.expected.map((_, legIndex) => ({ token: randomToken(18), transferId: t.id, legIndex })))
    .onConflictDoNothing();
  const rows = await ctx.db
    .select({ token: receiptLinksTable.token, legIndex: receiptLinksTable.legIndex })
    .from(receiptLinksTable)
    .where(eq(receiptLinksTable.transferId, t.id))
    .orderBy(asc(receiptLinksTable.legIndex));
  return rows.map((r) => r.token);
}

/** The one recipient's part that a link stands for. Anything else about the payment stays out. */
export async function receiptByToken(ctx: Ctx, token: string) {
  if (!TOKEN.test(token)) throw notFound("Receipt not found");
  const [row] = await ctx.db
    .select({ link: receiptLinksTable, t: transfers, payerEmail: users.email })
    .from(receiptLinksTable)
    .innerJoin(transfers, eq(transfers.id, receiptLinksTable.transferId))
    .leftJoin(users, eq(users.id, transfers.payerUserId))
    .where(eq(receiptLinksTable.token, token))
    .limit(1);
  const leg = row?.t.expected[row.link.legIndex];
  if (!row || !leg || row.t.status !== "settled") throw notFound("Receipt not found");
  return receiptView(ctx, row.t, row.link.legIndex, {
    email: row.payerEmail ?? row.t.visitorEmail ?? null,
    address: row.t.payerAddress,
  });
}
