import { createPublicClient, custom, fallback, http, type Transport } from "viem";

/** How far behind the highest RPC another may be (Arc makes blocks quickly; this is seconds). */
export const MAX_LAG_BLOCKS = 30;
const CHECK_EVERY_MS = 30_000;

/**
 * The configured RPCs, current ones first in their configured order, then any that are behind or
 * didn't answer. A node that falls behind would show old balances, which looks like lost money;
 * an error alone is not enough to notice that.
 */
export function freshOrder(urls: string[], heights: (number | null)[], maxLag = MAX_LAG_BLOCKS): string[] {
  const known = heights.filter((h): h is number => h !== null);
  if (!known.length) return urls;
  const top = Math.max(...known);
  const current = (i: number) => heights[i] !== null && top - heights[i]! <= maxLag;
  return [...urls.filter((_, i) => current(i)), ...urls.filter((_, i) => !current(i))];
}

/**
 * Like viem's `fallback` over `urls` (an RPC that errors is skipped), but the order is re-checked
 * every 30 seconds by block height, so the app reads from an up-to-date RPC: your own node while it
 * keeps up, the next one when it doesn't. The first request waits for the first check.
 */
export function freshTransport(urls: string[]): Transport {
  const build = (order: string[]) => fallback(order.map((url) => http(url, { timeout: 10_000, retryCount: 2 })));
  if (urls.length < 2) return build(urls);
  const probes = urls.map((url) => createPublicClient({ transport: http(url, { timeout: 5_000, retryCount: 0 }) }));
  let order = urls;
  let checkedAt = 0;
  let checking: Promise<void> | null = null;
  const check = async () => {
    const heights = await Promise.all(probes.map((p) => p.getBlockNumber().then(Number).catch(() => null)));
    const next = freshOrder(urls, heights);
    if (next[0] !== order[0]) console.warn(`[chain] reading from ${new URL(next[0]!).host}; block heights ${heights.join(", ")}`);
    order = next;
  };
  const refresh = () => {
    if (!checking && Date.now() - checkedAt > CHECK_EVERY_MS) {
      checkedAt = Date.now();
      checking = check().finally(() => {
        checking = null;
      });
    }
    return checking;
  };

  return (config) => {
    const instances = new Map<string, ReturnType<Transport>>();
    const current = () => {
      const key = order.join(",");
      let t = instances.get(key);
      if (!t) {
        t = build(order)(config);
        instances.set(key, t);
      }
      return t;
    };
    return custom({
      async request({ method, params }) {
        const pending = refresh();
        if (pending && instances.size === 0) await pending;
        return current().request({ method, params });
      },
    })(config);
  };
}
