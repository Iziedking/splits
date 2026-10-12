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
  message(sourceDomain: number, txHash: Hex): Promise<IrisMessage>;
}

export class IrisRateLimited extends Error {}

type Fetch = (url: string) => Promise<Response>;

export function httpIris(baseUrl: string, fetchImpl: Fetch = (url) => fetch(url, { cache: "no-store" })): Iris {
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
    async message(sourceDomain, txHash) {
      const res = await get(`/v2/messages/${sourceDomain}?transactionHash=${txHash}`);
      // 404: Circle hasn't seen the burn yet.
      if (res.status === 404) return { status: "missing" };
      if (!res.ok) throw new Error(`Iris messages ${res.status}`);
      const body = (await res.json()) as { messages?: { message: Hex; attestation: string; status: string; delayReason?: string | null }[] };
      const m = body.messages?.[0];
      if (!m) return { status: "missing" };
      if (m.status === "complete" && m.attestation !== "PENDING" && m.message !== "0x") {
        return { status: "complete", message: m.message, attestation: m.attestation as Hex };
      }
      return { status: "pending", delayReason: m.delayReason ?? null };
    },
  };
}
