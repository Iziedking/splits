import { eq } from "drizzle-orm";
import { users } from "./db/schema";
import { parseConfig } from "./config";
import { previewCtx, type Ctx } from "./context";
import { createPgliteDb } from "./db/client";
import { PreviewArc, type PreviewArcOptions } from "./preview/previewArc";
import { setInitialPin } from "./auth/pin";
import { finishSignIn, startSignIn } from "./services/signin";

/** A preview context on a fresh in-memory Postgres, with a clock tests can move. */
export async function testCtx(env: Record<string, string> = {}, arcOptions: PreviewArcOptions = {}) {
  const config = parseConfig({ SPLITS_MODE: "preview", ...env });
  const arc = new PreviewArc(arcOptions);
  const ctx = previewCtx(await createPgliteDb(), config, arc);
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

/** Signs a person in through the real OTP flow and sets their PIN. */
export async function signedInUser(ctx: Ctx, email: string, pin: string | null = TEST_PIN) {
  const { previewCode } = await startSignIn(ctx, email);
  const result = await finishSignIn(ctx, email, previewCode!);
  if (pin) await setInitialPin(ctx.db, result.user.id, pin);
  const [user] = await ctx.db.select().from(users).where(eq(users.id, result.user.id));
  return { ...result, user: user! };
}
