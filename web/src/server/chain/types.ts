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
  getSplit(splitId: bigint): Promise<OnchainSplit | null>;
  /** null while the transaction is not yet visible to the node. */
  receipt(txHash: Hex): Promise<RouterReceipt | null>;
}
