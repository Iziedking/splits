import { createPublicClient, erc20Abi, http, type Address } from "viem";
import type { CrossChainOption } from "@/lib/api";

export type ChainFunds = { key: string; usdc: bigint; gas: bigint; error: boolean };

/** USDC and gas on every chain, read from public RPCs; a chain that can't be read shows as an error. */
export async function readFunds(chains: CrossChainOption[], address: Address): Promise<ChainFunds[]> {
  return Promise.all(
    chains.map(async (c) => {
      try {
        const client = createPublicClient({ transport: http(c.rpcUrl, { timeout: 8_000 }) });
        const [usdc, gas] = await Promise.all([
          client.readContract({ address: c.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
          client.getBalance({ address }),
        ]);
        return { key: c.key, usdc, gas, error: false };
      } catch {
        return { key: c.key, usdc: 0n, gas: 0n, error: true };
      }
    }),
  );
}

/** The first chain, in the server's order, that covers the whole burn and has gas to send it. */
export function pickChain(funds: ChainFunds[], need: bigint): string | null {
  return funds.find((f) => !f.error && f.usdc >= need && f.gas > 0n)?.key ?? null;
}
