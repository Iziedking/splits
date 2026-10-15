import { api, json } from "@/server/http";
import { formatUsdc } from "@/server/domain/money";
import { chainLabel } from "@/server/views";

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
    /** Chains a visitor can pay from through SplitsCrossPay; null while cross-chain pay is off. */
    crossPay: ctx.crossPay && {
      address: ctx.crossPay.address,
      chains: ctx.crossPay.open.map((c) => ({
        key: c.key,
        name: chainLabel(ctx, c.key),
        chainId: c.chainId[ctx.crossChain.network],
        rpcUrl: c.rpc[ctx.crossChain.network],
        usdc: c.usdc[ctx.crossChain.network],
        tokenMessenger: ctx.crossChain.cctp.tokenMessenger,
        explorerUrl: c.explorer[ctx.crossChain.network],
        gas: c.gas,
        fast: c.fast,
      })),
    },
  }),
);
