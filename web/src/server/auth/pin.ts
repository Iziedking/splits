import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { badRequest, conflict, forbidden } from "../errors";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

export function assertPinShape(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw badRequest("PIN_FORMAT", "Your PIN must be 6 digits");
  if (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
    throw badRequest("PIN_TOO_SIMPLE", "Pick a PIN that isn't a repeated or straight sequence");
  }
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, KEY_LEN, PARAMS);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(pin, Buffer.from(saltB64, "base64"), expected.length, PARAMS);
  return timingSafeEqual(actual, expected);
}

/** Sets the first PIN. Changing a PIN later is a separate, confirmed flow. */
export async function setInitialPin(db: Db, userId: string, pin: string) {
  assertPinShape(pin);
  const pinHash = await hashPin(pin);
  const updated = await db
    .update(users)
    .set({ pinHash })
    .where(and(eq(users.id, userId), sql`${users.pinHash} is null`))
    .returning({ id: users.id });
  if (updated.length !== 1) throw conflict("PIN_ALREADY_SET", "You already have a PIN");
}

/**
 * Five wrong PINs lock confirmations for 15 minutes. The attempt is reserved with an atomic
 * increment before the comparison, so a burst of parallel guesses can't all be checked before the
 * lock lands.
 */
export async function verifyPin(db: Db, userId: string, pin: string, now: Date): Promise<void> {
  const [reserved] = await db
    .update(users)
    .set({ pinFailures: sql`${users.pinFailures} + 1` })
    .where(
      and(
        eq(users.id, userId),
        sql`${users.pinHash} is not null`,
        sql`(${users.pinLockedUntil} is null or ${users.pinLockedUntil} <= ${now})`,
        sql`${users.pinFailures} < ${MAX_FAILURES}`,
      ),
    )
    .returning({ pinHash: users.pinHash, failures: users.pinFailures });

  if (!reserved) {
    const [user] = await db.select({ pinHash: users.pinHash }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.pinHash) throw forbidden("PIN_NOT_SET", "Set up your PIN first");
    throw forbidden("PIN_LOCKED", "Too many wrong PINs. Try again in 15 minutes.");
  }

  if (await pinMatches(pin, reserved.pinHash!)) {
    await db.update(users).set({ pinFailures: 0, pinLockedUntil: null }).where(eq(users.id, userId));
    return;
  }
  if (reserved.failures >= MAX_FAILURES) {
    await db
      .update(users)
      .set({ pinFailures: 0, pinLockedUntil: new Date(now.getTime() + LOCK_MS) })
      .where(eq(users.id, userId));
    throw forbidden("PIN_LOCKED", "Too many wrong PINs. Try again in 15 minutes.");
  }
  throw forbidden("PIN_WRONG", `Wrong PIN. ${MAX_FAILURES - reserved.failures} tries left.`);
}

/** Changes the PIN. The current PIN is checked with the same lockout as any confirmation. */
export async function changePin(db: Db, userId: string, currentPin: string, newPin: string, now: Date) {
  assertPinShape(newPin);
  await verifyPin(db, userId, currentPin, now);
  await db.update(users).set({ pinHash: await hashPin(newPin) }).where(eq(users.id, userId));
}
