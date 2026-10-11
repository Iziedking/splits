import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { formatUnits, getAddress, type Address, type Hex } from "viem";
import { USDC_DECIMALS } from "../domain/money";
import type { ProviderTx, WalletProvider } from "./types";

export type CircleOptions = {
  apiKey: string;
  entitySecret: string;
  walletSetId: string;
  blockchain: "ARC" | "ARC-TESTNET";
  usdc: Address;
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
export function createCircleWallets(opts: CircleOptions): WalletProvider {
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: opts.apiKey,
    entitySecret: opts.entitySecret,
  });

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
        // With walletId the SDK infers the chain from the wallet; passing blockchain is a type error.
        walletId,
        tokenAddress: opts.usdc,
        destinationAddress: to,
        amount: [formatUnits(amount, USDC_DECIMALS)],
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey,
        refId,
      });
      if (!res.data?.id) throw new Error("Circle returned no transaction id");
      return { providerTxId: res.data.id };
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
