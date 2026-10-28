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

/** What SplitsCrossPay did with one payer's ref: paid it, or refunded (and whether it is held as owed). */
export type CrossOutcome = { kind: "paid"; txHash: Hex; feeBack: bigint } | { kind: "refunded"; txHash: Hex; amount: bigint; owed: boolean };

/** Everything the app reads from Arc. Writes go through the wallet provider, never through here. */
export interface ChainReader {
  usdcBalance(owner: Address): Promise<bigint>;
  usdcAllowance(owner: Address, spender: Address): Promise<bigint>;
  /** At `atBlock` when given: a node that hasn't reached it errors instead of answering "unused". */
  refUsed(payer: Address, ref: Hex, atBlock?: bigint): Promise<boolean>;
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
  /**
   * What SplitsCrossPay did with `ref` for `payer` (the address it pays back), from `fromBlock` on;
   * null if nothing yet. Matching the payer too means another burner's events that reuse the same
   * public ref are never mistaken for this payment.
   */
  /**
   * What SplitsCrossPay did with one CCTP message: found by the transmitter's mint of `nonce`, never
   * by the ref and payer in the hook, which whoever burns can choose. Null until it is minted.
   */
  crossPayOutcome(contract: Address, transmitter: Address, nonce: Hex, fromBlock: bigint): Promise<CrossOutcome | null>;
  /** The contract's constructor values, or null if `contract` has no code there. */
  crossPayWiring(contract: Address): Promise<{ usdc: Address; transmitter: Address; router: Address; tokenMessenger: Address } | null>;
}
