import { createHash, randomBytes } from "node:crypto";
import { keccak256, stringToHex, type Hex } from "viem";

/**
 * A UUID with v4 layout derived from a seed. Circle requires v4-shaped idempotency keys; deriving
 * them from (transfer, step, attempt) means a retried request reuses the same key and Circle
 * returns the original transaction instead of creating a second one.
 */
export function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The onchain `ref` for a transfer. The router refuses a second payment with the same ref. */
export function transferRef(transferId: string): Hex {
  return keccak256(stringToHex(`splits:transfer:${transferId}`));
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
