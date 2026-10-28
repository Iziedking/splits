import { decodeAbiParameters, decodeEventLog, encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, hexToBigInt, hexToNumber, keccak256, pad, size, slice, type Address, type Hex } from "viem";
import type { OnchainLeg } from "../chain/types";
import { ARC_DOMAIN } from "./chains";

export const burnAbi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

export const transmitterAbi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  { type: "function", name: "usedNonces", stateMutability: "view", inputs: [{ name: "nonce", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "localDomain", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  // MessageTransmitterV2 (circlefin/evm-cctp-contracts, src/v2/MessageTransmitterV2.sol).
  {
    type: "event",
    name: "MessageReceived",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "sourceDomain", type: "uint32", indexed: false },
      { name: "nonce", type: "bytes32", indexed: true },
      { name: "sender", type: "bytes32", indexed: false },
      { name: "finalityThresholdExecuted", type: "uint32", indexed: true },
      { name: "messageBody", type: "bytes", indexed: false },
    ],
  },
] as const;

/** Fast Transfer attests at "confirmed" (1000); Standard waits for "finalized" (2000). */
export const FAST = 1000;
export const STANDARD = 2000;

/** Left-padded to 32 bytes, lowercase (as bytes32 values decode), so comparisons are exact. */
export const toBytes32 = (address: Address | Hex): Hex => pad(address.toLowerCase() as Hex, { size: 32 });

export const encodeApprove = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });

/** A burn whose USDC can only be minted on Arc, to `mintRecipient`; anyone may relay the mint. */
export function encodeDepositForBurn(o: { amount: bigint; mintRecipient: Address; burnToken: Address; maxFee: bigint; fast: boolean }): Hex {
  return encodeFunctionData({
    abi: burnAbi,
    functionName: "depositForBurn",
    args: [o.amount, ARC_DOMAIN, toBytes32(o.mintRecipient), o.burnToken, pad("0x00"), o.maxFee, o.fast ? FAST : STANDARD],
  });
}

export const encodeReceiveMessage = (message: Hex, attestation: Hex): Hex =>
  encodeFunctionData({ abi: transmitterAbi, functionName: "receiveMessage", args: [message, attestation] });

/** The V2 nonce: bytes 12..44 of the message header (assigned by Circle, checked by usedNonces). */
export const nonceOf = (message: Hex): Hex => slice(message, 12, 44);

/**
 * The parts of a V2 burn message the app checks before trusting a mint: header (version, source,
 * destination, nonce, sender, recipient, caller, thresholds; 148 bytes) then the burn body
 * (version, burnToken, mintRecipient, amount, messageSender, maxFee, feeExecuted, …).
 */
export function parseBurnMessage(message: Hex) {
  const body = 148;
  return {
    sourceDomain: hexToNumber(slice(message, 4, 8)),
    destinationDomain: hexToNumber(slice(message, 8, 12)),
    nonce: nonceOf(message),
    destinationCaller: getAddress(slice(message, 108 + 12, 140)),
    mintRecipient: getAddress(slice(message, body + 36 + 12, body + 68)),
    amount: hexToBigInt(slice(message, body + 68, body + 100)),
    messageSender: getAddress(slice(message, body + 100 + 12, body + 132)),
    feeExecuted: hexToBigInt(slice(message, body + 164, body + 196)),
    hookData: size(message) > body + 228 ? slice(message, body + 228) : ("0x" as Hex),
  };
}

/**
 * The most the burn may pay in fees: Circle's quote in basis points (which can be fractional,
 * like 1.3), rounded up, plus a 20% buffer in case it rises before the burn lands.
 */
export function maxFeeFor(amount: bigint, bps: number): bigint {
  const centiBps = BigInt(Math.round(bps * 100));
  if (centiBps === 0n) return 0n;
  const fee = (amount * centiBps + 999_999n) / 1_000_000n;
  return (fee * 12n + 9n) / 10n;
}

export const burnWithHookAbi = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const depositForBurnEvent = {
  type: "event",
  name: "DepositForBurn",
  inputs: [
    { name: "burnToken", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
    { name: "depositor", type: "address", indexed: true },
    { name: "mintRecipient", type: "bytes32", indexed: false },
    { name: "destinationDomain", type: "uint32", indexed: false },
    { name: "destinationTokenMessenger", type: "bytes32", indexed: false },
    { name: "destinationCaller", type: "bytes32", indexed: false },
    { name: "maxFee", type: "uint256", indexed: false },
    { name: "minFinalityThreshold", type: "uint32", indexed: true },
    { name: "hookData", type: "bytes", indexed: false },
  ],
} as const;

const HOOK_VERSION = 1;
const hookParams = [
  { type: "uint8" },
  { type: "address" },
  {
    type: "tuple[]",
    components: [
      { name: "recipient", type: "address" },
      { name: "fixedAmount", type: "uint96" },
      { name: "shareBps", type: "uint16" },
      { name: "purpose", type: "bytes32" },
    ],
  },
  { type: "uint256" },
  { type: "bytes32" },
] as const;

/**
 * The split a cross-chain burn carries, exactly as SplitsCrossPay.decodeHook reads it. `refundTo`
 * is where a refund or the unused fee goes on Arc: the payer's own address.
 */
export const encodeHook = (legs: OnchainLeg[], payAmount: bigint, ref: Hex, refundTo: Address): Hex =>
  encodeAbiParameters(hookParams, [HOOK_VERSION, refundTo, legs, payAmount, ref]);

export function decodeHook(hook: Hex): { refundTo: Address; legs: OnchainLeg[]; payAmount: bigint; ref: Hex } | null {
  try {
    const [version, refundTo, legs, payAmount, ref] = decodeAbiParameters(hookParams, hook);
    if (version !== HOOK_VERSION) return null;
    return {
      refundTo: getAddress(refundTo),
      legs: legs.map((l) => ({ recipient: getAddress(l.recipient), fixedAmount: l.fixedAmount, shareBps: l.shareBps, purpose: l.purpose })),
      payAmount,
      ref,
    };
  } catch {
    return null;
  }
}

/** The ref SplitsCrossPay pays the router with (its routerRef): each payer's refs are their own. */
export const routerRefFor = (sourceDomain: number, payer: Address, ref: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint32" }, { type: "address" }, { type: "bytes32" }], [sourceDomain, payer, ref]));

/** A burn only SplitsCrossPay can mint (destinationCaller) and only to itself (mintRecipient). */
export function encodeDepositForBurnWithHook(o: { amount: bigint; burnToken: Address; maxFee: bigint; fast: boolean; hookData: Hex; crossPay: Address }): Hex {
  return encodeFunctionData({
    abi: burnWithHookAbi,
    functionName: "depositForBurnWithHook",
    args: [o.amount, ARC_DOMAIN, toBytes32(o.crossPay), o.burnToken, toBytes32(o.crossPay), o.maxFee, o.fast ? FAST : STANDARD, o.hookData],
  });
}

export type BurnLog = {
  burnToken: Address;
  amount: bigint;
  depositor: Address;
  mintRecipient: Address;
  destinationDomain: number;
  destinationCaller: Address;
  maxFee: bigint;
  minFinalityThreshold: number;
  hookData: Hex;
};

const fromBytes32 = (b: Hex): Address => getAddress(slice(b, 12, 32));

/** DepositForBurn events emitted by `tokenMessenger`; logs from any other contract are ignored. */
export function parseDepositForBurnLogs(logs: { address: string; topics: Hex[]; data: Hex }[], tokenMessenger: Address): BurnLog[] {
  const out: BurnLog[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== tokenMessenger.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: [depositForBurnEvent], data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      out.push({
        burnToken: getAddress(ev.args.burnToken),
        amount: ev.args.amount,
        depositor: getAddress(ev.args.depositor),
        mintRecipient: fromBytes32(ev.args.mintRecipient),
        destinationDomain: ev.args.destinationDomain,
        destinationCaller: fromBytes32(ev.args.destinationCaller),
        maxFee: ev.args.maxFee,
        minFinalityThreshold: ev.args.minFinalityThreshold,
        hookData: ev.args.hookData,
      });
    } catch {
      // Another TokenMessenger event.
    }
  }
  return out;
}
