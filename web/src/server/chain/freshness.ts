import { createPublicClient, custom, fallback, http, type Transport } from "viem";

/** How far behind the highest RPC another may be (Arc makes blocks quickly; this is seconds). */
export const MAX_LAG_BLOCKS = 30;
const CHECK_EVERY_MS = 30_000;

/**
 * The configured RPCs, current ones first in their configured order, then any that are behind or
 * didn't answer. A node that falls behind would show old balances, which looks like lost money;
 * an error alone is not enough to notice that. An RPC on another chain is left out altogether.
 *
 * "Current" is measured from the highest height at least two RPCs agree on, so with three or more
 * one endpoint reporting a wild height can't push every honest node to the back. With two that
 * disagree there is no majority, and the higher one is trusted: a stuck node is the usual failure.
 */
export function freshOrder(
  urls: string[],
  heights: (number | null)[],
  maxLag = MAX_LAG_BLOCKS,
  onChain: boolean[] = urls.map(() => true),
): string[] {
  const known = heights.filter((h, i): h is number => h !== null && onChain[i]!);
  const ours = (list: string[]) => list.filter((url) => onChain[urls.indexOf(url)]);
  if (!known.length) return ours(urls);
  const agreed = known.filter((h) => known.filter((o) => Math.abs(o - h) <= maxLag).length >= 2);
  const top = Math.max(...(agreed.length ? agreed : known));
  const current = (i: number) => heights[i] !== null && Math.abs(top - heights[i]!) <= maxLag;
  return ours([...urls.filter((_, i) => current(i)), ...urls.filter((_, i) => !current(i))]);
}

/**
 * Like viem's `fallback` over `urls` (an RPC that errors is skipped), but the order is re-checked
 * every 30 seconds by block height, so the app reads from an up-to-date RPC: your own node while it
 * keeps up, the next one when it doesn't. The first request waits for the first check.
 */
export function freshTransport(urls: string[], chainId?: number): Transport {
  const build = (order: string[]) => fallback(order.map((url) => http(url, { timeout: 10_000, retryCount: 2 })));
  if (urls.length < 2) return build(urls);
  const probes = urls.map((url) => createPublicClient({ transport: http(url, { timeout: 5_000, retryCount: 0 }) }));
  let order = urls;
  let checkedAt = 0;
  let checking: Promise<void> | null = null;
  // A chain id is read once per RPC: only "another chain" excludes it, never a failed read.
  const chains: (number | null)[] = urls.map(() => null);
  const check = async () => {
    const heights = await Promise.all(probes.map((p) => p.getBlockNumber().then(Number).catch(() => null)));
    await Promise.all(
      probes.map(async (p, i) => {
        if (chainId === undefined || chains[i] !== null) return;
        chains[i] = await p.getChainId().catch(() => null);
        if (chains[i] !== null && chains[i] !== chainId) console.error(`[chain] ignoring ${new URL(urls[i]!).host}: it is on chain ${chains[i]}, not ${chainId}`);
      }),
    );
    const onChain = chains.map((c) => c === null || chainId === undefined || c === chainId);
    const next = freshOrder(urls, heights, MAX_LAG_BLOCKS, onChain);
    if (!next.length) return;
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
