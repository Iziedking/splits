import type { Ctx } from "../context";

/** HH:MM UTC when the fixed window holding `now` ends. */
export function windowEnds(ctx: Ctx, windowMs: number): string {
  const now = ctx.now().getTime();
  return new Date(now - (now % windowMs) + windowMs).toISOString().slice(11, 16);
}

/** Rejects after `ms` and aborts the call, even if the model ignores the signal. */
export function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, ms);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}
