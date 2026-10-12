import type { Address, Hex } from "viem";

export type OnchainLeg = {
  recipient: Address;
  fixedAmount: bigint;
  shareBps: number;
  purpose: Hex;
};

export type OnchainSplit = {
  owner: Address;
  version: number;
  active: boolean;
  legs: OnchainLeg[];
};

export type RouterReceipt = {
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
  splitCreated: { splitId: bigint; owner: Address }[];
  splitLegsSet: { splitId: bigint; version: number }[];
  splitSent: { splitId: bigint; payer: Address; ref: Hex; amount: bigint; version: number }[];
  legPaid: { splitId: bigint; ref: Hex; recipient: Address; amount: bigint; purpose: Hex }[];
};

/** Everything the app reads from Arc. Writes go through the wallet provider, never through here. */
export interface ChainReader {
  usdcBalance(owner: Address): Promise<bigint>;
  usdcAllowance(owner: Address, spender: Address): Promise<bigint>;
  refUsed(payer: Address, ref: Hex): Promise<boolean>;
  /** True if `to` can receive USDC right now: simulates a 1-cent transfer from `from`, sends nothing. */
  canReceive(from: Address, to: Address): Promise<boolean>;
  getSplit(splitId: bigint): Promise<OnchainSplit | null>;
  /** null while the transaction is not yet visible to the node. */
  receipt(txHash: Hex): Promise<RouterReceipt | null>;
  blockNumber(): Promise<bigint>;
  /** The transaction in which `payer` paid with `ref`, searching from `fromBlock`; null if none yet. */
  findSplitSent(payer: Address, ref: Hex, fromBlock: bigint): Promise<Hex | null>;
  /** True once a CCTP message with this nonce was minted on Arc (by anyone). */
  cctpNonceUsed(transmitter: Address, nonce: Hex): Promise<boolean>;
}
