import { cookies } from "next/headers";
import { nearEnabled } from "@/lib/near/config";
import { SESSION_COOKIE, userForSession } from "../auth/sessions";
import { getCtx, type Ctx } from "../context";
import { forbidden, unauthorized } from "../errors";
import { errorResponse } from "../http";
import { custodyEnabled } from "./custody";

/** The NEAR host is not the Arc app's origin, so its routes check the request against its own host. */
function sameHost(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const isHttps = (req: Request) => (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";

/** A route for email accounts: 404 unless NEAR mode and email accounts are both on. */
export function emailAccountApi(handler: (a: { req: Request; ctx: Ctx }) => Promise<Response>) {
  return async (req: Request) => {
    if (!nearEnabled() || !custodyEnabled()) return new Response("Not found", { status: 404 });
    try {
      const ctx = await getCtx();
      if (req.method !== "GET" && !sameHost(req)) throw forbidden("CROSS_SITE", "Request blocked");
      return await handler({ req, ctx });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function sessionUser(ctx: Ctx) {
  return userForSession(ctx.db, (await cookies()).get(SESSION_COOKIE)?.value, ctx.now());
}

export async function requireSessionUser(ctx: Ctx) {
  const user = await sessionUser(ctx);
  if (!user) throw unauthorized();
  return user;
}
