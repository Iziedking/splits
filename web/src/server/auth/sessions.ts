import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { randomToken, sha256Hex } from "../domain/ids";

export const SESSION_COOKIE = "splits_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export async function createSession(db: Db, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: sha256Hex(token), userId, expiresAt, createdAt: now });
  return { token, expiresAt };
}

export async function userForSession(db: Db, token: string | undefined, now: Date) {
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256Hex(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  return row?.user ?? null;
}

export async function endSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
}
