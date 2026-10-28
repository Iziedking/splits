import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { and, eq, gt } from "drizzle-orm";
import { passkeyAssertionOptions, verifyPasskeyAssertion } from "../auth/passkeys";
import { verifyPin } from "../auth/pin";
import type { Ctx } from "../context";
import { actions } from "../db/schema";
import { randomToken } from "../domain/ids";
import { badRequest, conflict, notFound } from "../errors";

export type Action = typeof actions.$inferSelect;

const ACTION_TTL_MS = 5 * 60_000;

/**
 * Every money movement and every new split waits here until the user confirms it with their PIN
 * or a passkey. The random challenge ties a passkey signature to this one action.
 */
export async function createAction(
  ctx: Ctx,
  userId: string,
  type: Action["type"],
  subjectId: string,
  summary: Record<string, unknown>,
): Promise<Action> {
  const now = ctx.now();
  const [action] = await ctx.db
    .insert(actions)
    .values({
      userId,
      type,
      subjectId,
      summary,
      challenge: randomToken(32),
      expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
      createdAt: now,
    })
    .returning();
  return action!;
}

async function pendingAction(ctx: Ctx, userId: string, actionId: string): Promise<Action> {
  const [action] = await ctx.db
    .select()
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.userId, userId)))
    .limit(1);
  if (!action) throw notFound("This request no longer exists");
  if (action.status === "confirmed") throw conflict("ALREADY_CONFIRMED", "You already confirmed this");
  if (action.status === "expired" || action.expiresAt <= ctx.now()) {
    throw conflict("ACTION_EXPIRED", "This request expired. Start again.");
  }
  return action;
}

export async function passkeyOptionsForAction(ctx: Ctx, userId: string, actionId: string) {
  const action = await pendingAction(ctx, userId, actionId);
  return passkeyAssertionOptions(ctx.db, ctx.rp, userId, action.challenge);
}

export type Confirmation = { pin: string } | { passkey: AuthenticationResponseJSON };

/**
 * Checks the PIN or passkey, then marks the action confirmed exactly once. The type is checked
 * first, so a confirmation sent to the wrong route can't use up the action.
 */
export async function confirmAction(
  ctx: Ctx,
  userId: string,
  actionId: string,
  proof: Confirmation,
  type: Action["type"],
  wrongType: string,
): Promise<Action> {
  const action = await pendingAction(ctx, userId, actionId);
  if (action.type !== type) throw badRequest("WRONG_ACTION", wrongType);
  const now = ctx.now();
  if ("pin" in proof) await verifyPin(ctx.db, userId, proof.pin, now);
  else await verifyPasskeyAssertion(ctx.db, ctx.rp, userId, action.challenge, proof.passkey);

  const [confirmed] = await ctx.db
    .update(actions)
    .set({ status: "confirmed", method: "pin" in proof ? "pin" : "passkey", confirmedAt: now })
    .where(and(eq(actions.id, actionId), eq(actions.status, "pending"), gt(actions.expiresAt, now)))
    .returning();
  if (!confirmed) throw conflict("ALREADY_CONFIRMED", "You already confirmed this");
  return confirmed;
}
