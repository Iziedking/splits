import type { Ctx } from "./context";

export type Health = { ok: true; mode: Ctx["mode"]; network: Ctx["network"]; chainId: number };

/**
 * What GET /api/health reports. Built only from settings already on the context: no chain or
 * wallet calls and nothing secret, so load balancers and the deploy script can poll it freely.
 * The mode is there so a deploy can tell a live server from a preview one on the same chain id.
 */
export function healthReport(ctx: Pick<Ctx, "mode" | "network" | "chainId">): Health {
  return { ok: true, mode: ctx.mode, network: ctx.network, chainId: ctx.chainId };
}
