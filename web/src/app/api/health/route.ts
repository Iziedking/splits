import { healthReport } from "@/server/health";
import { api, json } from "@/server/http";

// Never prerender: the answer must come from the running server.
export const dynamic = "force-dynamic";

/**
 * Liveness and readiness for the container healthcheck and the deploy script. No sign-in. It
 * answers 200 only once the context is built (database reachable, migrations applied); after
 * that it is a cached object read.
 */
export const GET = api(async ({ ctx }) => {
  const res = json(healthReport(ctx));
  res.headers.set("cache-control", "no-store");
  return res;
});
