import { randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { otpCodes } from "../db/schema";
import { emailSchema } from "../domain/email";
import { sha256Hex } from "../domain/ids";
import { badRequest, tooMany } from "../errors";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;


export function normaliseEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) throw badRequest("INVALID_EMAIL", "Enter a valid email address");
  return email;
}

const hashCode = (email: string, code: string) => sha256Hex(`otp:${email}:${code}`);

export async function issueLoginCode(db: Db, email: string, now: Date): Promise<string> {
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), gt(otpCodes.createdAt, hourAgo)));
  if (count >= MAX_CODES_PER_HOUR) {
    throw tooMany("TOO_MANY_CODES", "Too many codes requested. Try again in an hour.");
  }
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.insert(otpCodes).values({
    email,
    codeHash: hashCode(email, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    createdAt: now,
  });
  return code;
}

/** Checks the newest live code. Wrong guesses count against it; five ends it. */
export async function consumeLoginCode(db: Db, email: string, code: string, now: Date): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const [row] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, now)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;

  const ok = timingSafeEqual(Buffer.from(row.codeHash, "hex"), Buffer.from(hashCode(email, code), "hex"));
  if (!ok) {
    await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, row.id));
    return false;
  }
  // Conditional update so two simultaneous correct submissions can't both sign in.
  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  return consumed.length === 1;
}
