import { describe, expect, it } from "vitest";
import { testCtx } from "../testing";
import { hitRateLimit } from "./rateLimits";

describe("rate limits", () => {
  it("allows up to the limit per window, then opens again next window", async () => {
    const { ctx, clock } = await testCtx();
    for (let i = 0; i < 3; i++) expect(await hitRateLimit(ctx, "check:v:abc", 3, 3_600_000)).toBe(true);
    expect(await hitRateLimit(ctx, "check:v:abc", 3, 3_600_000)).toBe(false);
    expect(await hitRateLimit(ctx, "check:v:other", 3, 3_600_000)).toBe(true);
    clock.advance(3_600_000);
    expect(await hitRateLimit(ctx, "check:v:abc", 3, 3_600_000)).toBe(true);
  });

  it("counts every hit when many arrive at once", async () => {
    const { ctx } = await testCtx();
    const results = await Promise.all(Array.from({ length: 10 }, () => hitRateLimit(ctx, "burst", 4, 3_600_000)));
    expect(results.filter(Boolean)).toHaveLength(4);
  });
});
