import { cookies } from "next/headers";
import { SESSION_COOKIE, userForSession } from "./auth/sessions";
import type { Ctx } from "./context";
import { conflict } from "./errors";
import { randomToken, sha256Hex } from "./domain/ids";
import type { Visitor } from "./services/visitorPayments";

export const VISITOR_COOKIE = "splits_visitor";

/** Who a no-account visitor is: a random cookie (only its hash is stored) and, behind our proxy, their IP. */
export async function visitorFrom(ctx: Ctx, req: Request): Promise<Visitor> {
  const jar = await cookies();
  // Signed-in people pay from their account, under their account's limits, never as a visitor.
  if (await userForSession(ctx.db, jar.get(SESSION_COOKIE)?.value, ctx.now())) {
    throw conflict("SIGNED_IN", "You're signed in. Pay from your account instead.");
  }
  let key = jar.get(VISITOR_COOKIE)?.value;
  if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    key = randomToken(32);
    jar.set(VISITOR_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.rp.origin.startsWith("https://"),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return { keyHash: sha256Hex(key), ip: clientIp(req.headers, ctx.trustProxy) };
}

/**
 * The visitor's IP behind our own proxy: the last x-forwarded-for hop, which that proxy appends.
 * Earlier hops are whatever the client sent and can't be trusted. Null when not behind our proxy.
 */
export function clientIp(headers: Headers, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const hops = headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean) ?? [];
  return hops.at(-1) ?? null;
}
