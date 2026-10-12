import { encodeFunctionData, erc20Abi, getAddress, hexToBigInt, hexToNumber, pad, slice, type Address, type Hex } from "viem";
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
    mintRecipient: getAddress(slice(message, body + 36 + 12, body + 68)),
    amount: hexToBigInt(slice(message, body + 68, body + 100)),
    feeExecuted: hexToBigInt(slice(message, body + 164, body + 196)),
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
