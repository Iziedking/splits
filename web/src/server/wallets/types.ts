import type { Address, Hex } from "viem";

/** USDC that arrived in a wallet. */
export type InboundTx = { txHash: Hex; from: Address; amount: bigint; at: Date };

export type ProviderTxStatus = "pending" | "complete" | "failed";

export type ProviderTx = {
  status: ProviderTxStatus;
  /** The provider's own state name, kept for logs and support. */
  rawState: string;
  txHash?: Hex;
  error?: string;
};

/**
 * The only way money moves. Live mode is Circle developer-controlled wallets; preview mode is an
 * in-memory simulation with the same contract. Every write takes an idempotency key, so retrying a
 * call returns the original transaction instead of creating a new one.
 */
export interface WalletProvider {
  createWallet(input: { refId: string; name: string; idempotencyKey: string }): Promise<{
    providerWalletId: string;
    address: Address;
  }>;
  execute(input: {
    walletId: string;
    contract: Address;
    callData: Hex;
    idempotencyKey: string;
    refId: string;
  }): Promise<{ providerTxId: string }>;
  transferUsdc(input: {
    walletId: string;
    to: Address;
    amount: bigint;
    idempotencyKey: string;
    refId: string;
  }): Promise<{ providerTxId: string }>;
  getTx(providerTxId: string): Promise<ProviderTx>;
  /** USDC that arrived in this wallet, newest first. Used for the activity list. */
  /**
   * Inbound transfers, newest first. Finished ones only, unless `confirmed`: deposits accept
   * Circle's earlier CONFIRMED state because they are verified on chain before they count.
   */
  listInbound(walletId: string, limit: number, opts?: { confirmed?: boolean }): Promise<InboundTx[]>;
  walletAddress(walletId: string): Promise<Address>;
  /**
   * The same wallet on another EVM chain (same address), for deposits from that chain. Returns
   * the existing one if it was derived before. `blockchain` is a Circle code such as "BASE".
   */
  deriveOn(walletId: string, blockchain: string): Promise<{ providerWalletId: string; address: Address }>;
}
