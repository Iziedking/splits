import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { EarnKit } from "@circle-fin/earn-kit";
import { formatUnits, getAddress, type Address } from "viem";
import { USDC_DECIMALS } from "../domain/money";
import { usdcUnits, vetVault, type EarnProvider, type EarnVault } from "./types";

type Options = { apiKey: string; entitySecret: string; chain: "Arc" | "Arc_Testnet"; vault: Address; minLiquidity: bigint; requireVetted: boolean };

const VAULT_CACHE_MS = 60_000;

/** Earn Kit's answer for a wallet with no position in the vault yet (seen on Arc Testnet, 2026-10-14). */
export function noPositionYet(err: unknown): boolean {
  const e = err as { message?: string; cause?: { trace?: { earnServiceCode?: number } } } | null;
  return e?.cause?.trace?.earnServiceCode === 380407 || /position is not registered/i.test(e?.message ?? "");
}

/**
 * Arc Earn Kit over Circle developer-controlled wallets: each Splits wallet deposits into and
 * withdraws from the pinned vault itself, with gas paid by Gas Station. Proven on Arc Testnet on
 * 2026-10-14 (1.00 in, 0.999999 back). Returns null, and logs why, when the pinned vault isn't one
 * Splits will offer.
 */
export async function createLiveEarn(opts: Options): Promise<EarnProvider | null> {
  const kit = new EarnKit();
  const adapter = createCircleWalletsAdapter({ apiKey: opts.apiKey, entitySecret: opts.entitySecret });
  const vaultAddress = getAddress(opts.vault);
  let cached: { at: number; vault: EarnVault } | null = null;

  async function findVault(): Promise<EarnVault> {
    if (cached && Date.now() - cached.at < VAULT_CACHE_MS) return cached.vault;
    for (let page = 1; page <= 5; page++) {
      const { vaults } = await kit.exploreVaults({ chain: opts.chain, pageSize: 100, page });
      const v = vaults.find((x) => x.vaultAddress.toLowerCase() === vaultAddress.toLowerCase());
      if (v) {
        const vault: EarnVault = {
          address: getAddress(v.vaultAddress),
          name: v.name || "USDC vault",
          apy: Number(v.currentApy ?? 0),
          status: String(v.status),
          circleGuarded: Boolean(v.circleGuarded),
          liquidity: usdcUnits(String(v.liquidity ?? "0")),
          asset: String(v.asset),
        };
        cached = { at: Date.now(), vault };
        return vault;
      }
      if (vaults.length < 100) break;
    }
    throw new Error(`Earn vault ${vaultAddress} is not listed on ${opts.chain}`);
  }

  const from = (owner: Address) => ({ adapter, chain: opts.chain, address: owner });
  const provider: EarnProvider = {
    vault: findVault,
    async position(owner) {
      let p;
      try {
        p = await kit.getPosition({ from: from(owner), vaultAddress });
      } catch (err) {
        // A wallet that never deposited has no position yet; Earn Kit reports that as an error
        // (earn service code 380407, "position is not registered") rather than a zero.
        if (noPositionYet(err)) return { assets: 0n, principal: 0n };
        throw err;
      }
      return {
        assets: usdcUnits(String(p.currentBalance ?? "0")),
        principal: p.pnl?.status === "available" ? usdcUnits(String(p.pnl.principalDeposited)) : null,
      };
    },
    async deposit(owner, amount) {
      const r = await kit.deposit({ from: from(owner), vaultAddress, amount: formatUnits(amount, USDC_DECIMALS) });
      return { txHash: String(r.txHash) };
    },
    async withdraw(owner, amount) {
      const r = await kit.withdraw({ from: from(owner), vaultAddress, amount: formatUnits(amount, USDC_DECIMALS) });
      return { txHash: String(r.txHash) };
    },
  };

  try {
    const reason = vetVault(await findVault(), opts.minLiquidity, opts.requireVetted);
    if (reason) {
      console.error(`[earn] vault ${vaultAddress} refused (${reason}); the Earning pocket stays off`);
      return null;
    }
  } catch (err) {
    console.error(`[earn] vault check failed (${err instanceof Error ? err.message : err}); the Earning pocket stays off`);
    return null;
  }
  return provider;
}
