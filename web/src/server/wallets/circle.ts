import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { formatUnits, getAddress, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { USDC_DECIMALS } from "../domain/money";
import type { InboundTx, ProviderTx, WalletProvider } from "./types";

export type CircleOptions = {
  apiKey: string;
  entitySecret: string;
  walletSetId: string;
  blockchain: "ARC" | "ARC-TESTNET";
  usdc: Address;
  /** Circle's token id for USDC's ERC-20 interface on this chain. Looked up if not given. */
  usdcTokenId?: string;
};

const COMPLETE = new Set(["COMPLETE"]);
const FAILED = new Set(["FAILED", "DENIED", "CANCELLED"]);

export function mapCircleState(state: string | undefined): ProviderTx["status"] {
  if (state && COMPLETE.has(state)) return "complete";
  if (state && FAILED.has(state)) return "failed";
  // STUCK stays pending: it needs an accelerate or cancel, not a silent retry that could double-send.
  return "pending";
}

const webhookKeys = new Map<string, string>();

/** Public key Circle used to sign a webhook. Keys are static per id, so they are cached. */
export async function fetchCircleWebhookKey(apiKey: string, keyId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(keyId)) throw new Error("Malformed webhook key id");
  const cached = webhookKeys.get(keyId);
  if (cached) return cached;
  const res = await fetch(`https://api.circle.com/v2/notifications/publicKey/${keyId}`, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Circle public key lookup failed with ${res.status}`);
  const body = (await res.json()) as { data?: { publicKey?: string; algorithm?: string } };
  if (body.data?.algorithm !== "ECDSA_SHA_256" || !body.data.publicKey) {
    throw new Error("Unexpected webhook key algorithm");
  }
  webhookKeys.set(keyId, body.data.publicKey);
  return body.data.publicKey;
}

/**
 * Circle developer-controlled wallets on Arc. Wallets are SCA so Gas Station pays gas; the
 * Gas Station policy itself lives in the Circle Console.
 */
/** Circle's final inbound state is COMPLETE (its docs also show COMPLETED); CONFIRMED comes first. */
export function inboundStateOk(state: string | undefined, confirmed: boolean): boolean {
  return state === "COMPLETE" || state === "COMPLETED" || (confirmed && state === "CONFIRMED");
}

export function createCircleWallets(opts: CircleOptions): WalletProvider {
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: opts.apiKey,
    entitySecret: opts.entitySecret,
  });

  // Circle lists USDC on Arc twice: as the native gas token (18 decimals) and as the ERC-20
  // interface at 0x3600... (6 decimals). Transfers must name the ERC-20 one by token id; sending
  // tokenAddress with a walletId is rejected as "API parameter invalid" (seen on Arc Testnet,
  // 2026-10-11). The id is looked up once from a funded wallet, or pinned with CIRCLE_USDC_TOKEN_ID.
  let usdcTokenId = opts.usdcTokenId;
  async function resolveUsdcTokenId(walletId: string): Promise<string> {
    if (usdcTokenId) return usdcTokenId;
    const res = await client.getWalletTokenBalance({ id: walletId, includeAll: true });
    const token = res.data?.tokenBalances?.find(
      (b) => !b.token.isNative && b.token.tokenAddress?.toLowerCase() === opts.usdc.toLowerCase(),
    )?.token;
    if (!token?.id) {
      throw new Error(`USDC ${opts.usdc} is not listed for wallet ${walletId}. Fund it, or set CIRCLE_USDC_TOKEN_ID.`);
    }
    usdcTokenId = token.id;
    return token.id;
  }

  return {
    async createWallet({ refId, name, idempotencyKey }) {
      const res = await client.createWallets({
        walletSetId: opts.walletSetId,
        blockchains: [opts.blockchain],
        accountType: "SCA",
        count: 1,
        metadata: [{ name, refId }],
        idempotencyKey,
      });
      const wallet = res.data?.wallets?.[0];
      if (!wallet?.id || !wallet.address) throw new Error("Circle returned no wallet");
      return { providerWalletId: wallet.id, address: getAddress(wallet.address) };
    },

    async execute({ walletId, contract, callData, idempotencyKey, refId }) {
      const res = await client.createContractExecutionTransaction({
        walletId,
        contractAddress: contract,
        callData,
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey,
        refId,
      });
      if (!res.data?.id) throw new Error("Circle returned no transaction id");
      return { providerTxId: res.data.id };
    },

    async transferUsdc({ walletId, to, amount, idempotencyKey, refId }) {
      const res = await client.createTransaction({
        walletId,
        tokenId: await resolveUsdcTokenId(walletId),
        destinationAddress: to,
        amount: [formatUnits(amount, USDC_DECIMALS)],
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey,
        refId,
      });
      if (!res.data?.id) throw new Error("Circle returned no transaction id");
      return { providerTxId: res.data.id };
    },

    async listInbound(walletId, limit, opts) {
      const res = await client.listTransactions({ walletIds: [walletId], txType: "INBOUND", pageSize: limit });
      // Not filtered by token id: on Arc, USDC can arrive through the native or the ERC-20 view of
      // the same balance, and Circle may list each. One entry per transaction hash is kept.
      const seen = new Set<string>();
      const out: InboundTx[] = [];
      for (const t of res.data?.transactions ?? []) {
        const amount = t.amounts?.[0];
        if (!inboundStateOk(t.state, opts?.confirmed ?? false) || !t.txHash || !amount || seen.has(t.txHash.toLowerCase())) continue;
        seen.add(t.txHash.toLowerCase());
        out.push({
          txHash: t.txHash as Hex,
          from: t.sourceAddress ? getAddress(t.sourceAddress) : zeroAddress,
          amount: parseUnits(amount, USDC_DECIMALS),
          at: new Date(t.createDate),
        });
      }
      return out;
    },

    async deriveOn(walletId, blockchain) {
      // 201 creates it, 200 returns the existing one: safe to call again.
      const res = await client.deriveWallet({ id: walletId, blockchain: blockchain as never });
      const wallet = res.data?.wallet;
      if (!wallet?.id || !wallet.address) throw new Error(`Circle could not derive wallet ${walletId} on ${blockchain}`);
      return { providerWalletId: wallet.id, address: getAddress(wallet.address) };
    },

    async walletAddress(walletId) {
      const res = await client.getWallet({ id: walletId });
      const address = res.data?.wallet?.address;
      if (!address) throw new Error(`Circle wallet ${walletId} has no address`);
      return getAddress(address);
    },

    async getTx(providerTxId) {
      const res = await client.getTransaction({ id: providerTxId });
      const tx = res.data?.transaction;
      const state = tx?.state;
      return {
        status: mapCircleState(state),
        rawState: state ?? "UNKNOWN",
        txHash: tx?.txHash ? (tx.txHash as Hex) : undefined,
        error: tx?.errorReason ?? tx?.errorDetails ?? undefined,
      };
    },
  };
}
