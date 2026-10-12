import type { Ctx } from "./context";

export type Health = { ok: true; network: Ctx["network"]; chainId: number };

/**
 * What GET /api/health reports. Built only from settings already on the context: no chain or
 * wallet calls and nothing secret, so load balancers and the deploy script can poll it freely.
 */
export function healthReport(ctx: Pick<Ctx, "network" | "chainId">): Health {
  return { ok: true, network: ctx.network, chainId: ctx.chainId };
}
