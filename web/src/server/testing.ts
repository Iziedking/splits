import { eq } from "drizzle-orm";
import { users } from "./db/schema";
import { parseConfig } from "./config";
import { previewCtx, type Ctx } from "./context";
import { randomUUID } from "node:crypto";
import { createPgliteDb, createPostgresDb, type Db } from "./db/client";
import { PreviewArc, type PreviewArcOptions } from "./preview/previewArc";
import { setInitialPin } from "./auth/pin";
import { finishSignIn, startSignIn } from "./services/signin";
import { claimTag } from "./services/tags";
import { suggestTag } from "./domain/tags";

/**
 * A fresh, migrated database for one test context. With TEST_DATABASE_URL set (CI and the VPS
 * gate), it is a new database on a real Postgres server through the production driver, because
 * PGlite accepts things postgres-js refuses (a raw Date parameter was the first). Otherwise PGlite.
 */
async function freshDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return createPgliteDb();
  const { default: postgres } = await import("postgres");
  const name = `t_${randomUUID().replace(/-/g, "")}`;
  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const dbUrl = new URL(url);
  dbUrl.pathname = `/${name}`;
  // Idle connections close after a second, so a whole run fits the server's default 100.
  return createPostgresDb(dbUrl.toString(), { max: 2, idleTimeout: 1 });
}

/** A preview context on a fresh database (PGlite, or real Postgres in CI), with a movable clock. */
export async function testCtx(env: Record<string, string> = {}, arcOptions: PreviewArcOptions = {}) {
  // Fees are off unless a test turns them on, so amounts in older tests keep their meaning.
  const config = parseConfig({ SPLITS_MODE: "preview", FEE_BPS: "0", FEE_MANY_BPS: "0", ...env });
  const arc = new PreviewArc(arcOptions);
  const ctx = previewCtx(await freshDb(), config, arc);
  let now = new Date("2026-10-12T09:00:00Z");
  const clock = {
    now: () => now,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
  const testContext: Ctx = { ...ctx, now: () => clock.now() };
  return { ctx: testContext, arc, clock };
}

export const TEST_PIN = "482913";

/**
 * Signs a person in through the real OTP flow, sets their PIN and takes a Split tag, as sign-up
 * does. Pass `tag: null` for an account still at /setup; the default comes from the email.
 */
export async function signedInUser(ctx: Ctx, email: string, pin: string | null = TEST_PIN, tag: string | null = suggestTag(email)) {
  const { previewCode } = await startSignIn(ctx, email);
  const result = await finishSignIn(ctx, email, previewCode!);
  if (pin) await setInitialPin(ctx.db, result.user.id, pin);
  // Two test emails can share a first part; the second gets a random tag instead.
  if (tag && !result.user.tag) await claimTag(ctx, result.user, tag).catch(() => claimTag(ctx, result.user, `u_${randomUUID().slice(0, 8)}`));
  const [user] = await ctx.db.select().from(users).where(eq(users.id, result.user.id));
  return { ...result, user: user! };
}
