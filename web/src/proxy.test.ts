import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

afterEach(() => {
  delete process.env.NEAR_HOSTS;
});

describe("proxy", () => {
  it("leaves mysplits.xyz untouched", () => {
    process.env.NEAR_HOSTS = "near.mysplits.xyz";
    for (const path of ["/", "/send", "/r/abc", "/near"]) {
      const res = proxy(new NextRequest(`https://mysplits.xyz${path}`, { headers: { host: "mysplits.xyz" } }));
      expect(rewrittenTo(res), path).toBeNull();
    }
  });

  it("does nothing at all when no NEAR host is set", () => {
    const res = proxy(new NextRequest("https://near.mysplits.xyz/", { headers: { host: "near.mysplits.xyz" } }));
    expect(rewrittenTo(res)).toBeNull();
  });

  it("opens near.mysplits.xyz into NEAR mode", () => {
    process.env.NEAR_HOSTS = "near.mysplits.xyz";
    const at = (path: string) => rewrittenTo(proxy(new NextRequest(`https://near.mysplits.xyz${path}`, { headers: { host: "near.mysplits.xyz" } })));
    expect(at("/")).toBe("https://near.mysplits.xyz/near");
    expect(at("/send")).toBe("https://near.mysplits.xyz/near/send");
    expect(at("/pay/ada.testnet")).toBe("https://near.mysplits.xyz/near/pay/ada.testnet");
    expect(at("/near/split")).toBeNull();
  });

  it("runs on pay links (account names have dots) but not on assets or APIs", () => {
    const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    expect(runs("/pay/ada.testnet")).toBe(true);
    expect(runs("/r/9VCLC4F4FKZYDaPLJxr14ThM6gvem1RcSLDVVFmRW1M")).toBe(true);
    expect(runs("/")).toBe(true);
    expect(runs("/api/near/draft")).toBe(false);
    expect(runs("/brand/logo.svg")).toBe(false);
    expect(runs("/_next/static/chunks/app.js")).toBe(false);
    expect(runs("/chains/arc.webp")).toBe(false);
  });
});
