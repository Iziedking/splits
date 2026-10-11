/**
 * Starts the background sweeper when the app runs as a long-lived Node server. Overlapping runs
 * are skipped, and a failed run is logged and retried on the next tick.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getConfig } = await import("./server/config");
  const interval = getConfig().SWEEP_INTERVAL_MS;
  if (interval === 0) return;

  const { getCtx } = await import("./server/context");
  const { sweep } = await import("./server/services/sweeper");
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await sweep(await getCtx());
      if (result.errors > 0) console.warn("[sweep]", result);
    } catch (err) {
      console.error("[sweep] run failed", err);
    } finally {
      running = false;
    }
  }, interval).unref();
}
