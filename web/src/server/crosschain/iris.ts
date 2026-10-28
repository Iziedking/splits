import type { Hex } from "viem";
import { FAST as FAST_THRESHOLD, STANDARD as STANDARD_THRESHOLD } from "./cctp";
import { ARC_DOMAIN } from "./chains";

export type IrisMessage =
  | { status: "missing" }
  | { status: "pending"; delayReason: string | null }
  | { status: "complete"; message: Hex; attestation: Hex };

/** Circle's attestation service (Iris V2): burn fees, and the signed message for a burn. */
export interface Iris {
  fees(sourceDomain: number): Promise<{ fastBps: number; standardBps: number }>;
  /**
   * The signed message for a burn. A transaction can hold several burns (a batching wallet, a
   * bundle); `matches` picks ours by its contents, otherwise the first is taken.
   */
  message(sourceDomain: number, txHash: Hex, matches?: (message: Hex) => boolean): Promise<IrisMessage>;
  /** Circle's remaining Fast Transfer allowance, in USDC base units. */
  fastAllowance(): Promise<bigint>;
  /** Asks Circle to re-attest an expired Fast message; the next message() call returns it. */
  reattest(nonce: Hex): Promise<void>;
}

export class IrisRateLimited extends Error {}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function httpIris(baseUrl: string, fetchImpl: Fetch = (url, init) => fetch(url, { cache: "no-store", ...init })): Iris {
  const get = async (path: string) => {
    const res = await fetchImpl(`${baseUrl}${path}`);
    // Circle blocks every request for 5 minutes past 35 per second; the caller backs off.
    if (res.status === 429) throw new IrisRateLimited("Iris rate limit");
    return res;
  };
  return {
    async fees(sourceDomain) {
      const res = await get(`/v2/burn/USDC/fees/${sourceDomain}/${ARC_DOMAIN}`);
      if (!res.ok) throw new Error(`Iris fees ${res.status}`);
      const list = (await res.json()) as { finalityThreshold: number; minimumFee: number }[];
      const pick = (t: number) => list.find((f) => f.finalityThreshold === t)?.minimumFee;
      const fastBps = pick(FAST_THRESHOLD);
      const standardBps = pick(STANDARD_THRESHOLD);
      if (fastBps === undefined || standardBps === undefined) throw new Error("Iris fees: missing a finality threshold");
      return { fastBps, standardBps };
    },
    async message(sourceDomain, txHash, matches) {
      const res = await get(`/v2/messages/${sourceDomain}?transactionHash=${txHash}`);
      // 404: Circle hasn't seen the burn yet.
      if (res.status === 404) return { status: "missing" };
      if (!res.ok) throw new Error(`Iris messages ${res.status}`);
      const body = (await res.json()) as { messages?: { message: Hex; attestation: string; status: string; delayReason?: string | null }[] };
      const all = body.messages ?? [];
      const done = (m: (typeof all)[number]) => m.status === "complete" && m.attestation !== "PENDING" && m.message !== "0x";
      // A message still being attested may have no body yet, so it can't be ruled out.
      const candidates = matches ? all.filter((m) => !done(m) || matches(m.message)) : all.slice(0, 1);
      const m = candidates.find(done) ?? candidates[0];
      if (!m) return { status: "missing" };
      if (done(m)) return { status: "complete", message: m.message, attestation: m.attestation as Hex };
      return { status: "pending", delayReason: m.delayReason ?? null };
    },
    async fastAllowance() {
      const res = await get(`/v2/fastBurn/USDC/allowance`);
      if (!res.ok) throw new Error(`Iris allowance ${res.status}`);
      const body = (await res.json()) as { allowance: number };
      return BigInt(Math.floor(body.allowance * 1_000_000));
    },
    async reattest(nonce) {
      const res = await fetchImpl(`${baseUrl}/v2/reattest/${nonce}`, { method: "POST" });
      if (res.status === 429) throw new IrisRateLimited("Iris rate limit");
      if (!res.ok) throw new Error(`Iris reattest ${res.status}`);
    },
  };
}
