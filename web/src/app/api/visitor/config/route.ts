import { api, json } from "@/server/http";
import { formatUsdc } from "@/server/domain/money";

/** What a visitor's browser needs to pay on Arc. Nothing here is secret. */
export const GET = api(async ({ ctx }) =>
  json({
    live: ctx.mode === "live",
    network: ctx.network,
    chainId: ctx.chainId,
    rpcUrl: ctx.publicRpcUrl,
    explorerUrl: ctx.explorerUrl,
    router: ctx.router,
    usdc: ctx.usdc,
    limits: { perPayment: formatUsdc(ctx.limits.visitorPerPayment), daily: formatUsdc(ctx.limits.visitorDaily) },
  }),
);
