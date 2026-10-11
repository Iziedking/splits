import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { SESSION_COOKIE, userForSession } from "./auth/sessions";
import { getCtx, type Ctx } from "./context";
import { passkeys } from "./db/schema";
import { AppError, badRequest, forbidden, unauthorized } from "./errors";
import type { User } from "./services/users";

type RouteParams = { params: Promise<Record<string, string>> };
type Handler = (input: { req: Request; ctx: Ctx; params: Record<string, string> }) => Promise<Response>;

/** Wraps a route: builds the context, blocks cross-site writes, and maps errors to JSON. */
export function api(handler: Handler) {
  return async (req: Request, route: RouteParams) => {
    try {
      const ctx = await getCtx();
      if (req.method !== "GET" && !sameOrigin(req, ctx)) throw forbidden("CROSS_SITE", "Request blocked");
      return await handler({ req, ctx, params: await route.params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Webhooks come from Circle, not the browser, so they skip the same-origin check. */
export function webhookApi(handler: Handler) {
  return async (req: Request, route: RouteParams) => {
    try {
      return await handler({ req, ctx: await getCtx(), params: await route.params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

function sameOrigin(req: Request, ctx: Ctx): boolean {
  const origin = req.headers.get("origin");
  // Non-browser clients send no Origin; session cookies are SameSite=Lax as a second line.
  return origin === null || origin === ctx.rp.origin;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Some fields are missing or invalid", issues: err.issues } },
      { status: 400 },
    );
  }
  console.error("[api] unexpected error", err);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong on our side. Your money is safe; try again." } },
    { status: 500 },
  );
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("INVALID_JSON", "Request body must be JSON");
  }
  return schema.parse(body);
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function requireUser(ctx: Ctx): Promise<User> {
  const user = await userForSession(ctx.db, await sessionToken(), ctx.now());
  if (!user) throw unauthorized();
  return user;
}

export async function hasPasskey(ctx: Ctx, userId: string): Promise<boolean> {
  const rows = await ctx.db.select({ id: passkeys.credentialId }).from(passkeys).where(eq(passkeys.userId, userId)).limit(1);
  return rows.length > 0;
}

export function json(data: unknown, status = 200): Response {
  return NextResponse.json(data, { status });
}
