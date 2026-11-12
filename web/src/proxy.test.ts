import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy, REWRITE_HEADER } from "./proxy";

const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

afterEach(() => {
  delete process.env.NEAR_HOSTS;
});

describe("proxy", () => {
  it("leaves mysplits.xyz untouched", () => {
    process.env.NEAR_HOSTS = "near.mysplits.xyz";
    for (const path of ["/", "/send", "/r/abc", "/signin"]) {
      const res = proxy(new NextRequest(`https://mysplits.xyz${path}`, { headers: { host: "mysplits.xyz" } }));
      expect(rewrittenTo(res), path).toBeNull();
      expect(res.status, path).toBe(200);
    }
  });

  it("keeps NEAR pages and APIs off every other host once NEAR hosts are set", () => {
    process.env.NEAR_HOSTS = "near.mysplits.xyz";
    for (const path of ["/near", "/near/send", "/near/pay/ada.testnet", "/api/near/draft"]) {
      const res = proxy(new NextRequest(`https://mysplits.xyz${path}`, { headers: { host: "mysplits.xyz" } }));
      expect(res.status, path).toBe(404);
    }
  });

  it("lets its own rewrite through on the second pass, but not a forged mark", () => {
    process.env.NEAR_HOSTS = "near.mysplits.xyz";
    const first = proxy(new NextRequest("https://near.mysplits.xyz/send", { headers: { host: "near.mysplits.xyz" } }));
    const mark = first.headers.get(`x-middleware-request-${REWRITE_HEADER}`);
    expect(mark).toMatch(/^[0-9a-f-]{36}$/);
    // Next re-runs the proxy on the rewritten URL, where the host reads as the server's own.
    const second = proxy(new NextRequest("http://localhost:3930/near/send", { headers: { host: "localhost:3930", [REWRITE_HEADER]: mark! } }));
    expect(second.status).toBe(200);
    const forged = proxy(new NextRequest("https://mysplits.xyz/near", { headers: { host: "mysplits.xyz", [REWRITE_HEADER]: "00000000-0000-0000-0000-000000000000" } }));
    expect(forged.status).toBe(404);
  });

  it("lets the NEAR APIs through on the NEAR host", () => {
    process.env.NEAR_HOSTS = "near.mysplits.xyz";
    const res = proxy(new NextRequest("https://near.mysplits.xyz/api/near/draft", { headers: { host: "near.mysplits.xyz" } }));
    expect(res.status).toBe(200);
    expect(rewrittenTo(res)).toBeNull();
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

  it("runs on pages and the NEAR APIs, never on other APIs or assets", () => {
    const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    expect(runs("/pay/ada.testnet")).toBe(true);
    expect(runs("/r/9VCLC4F4FKZYDaPLJxr14ThM6gvem1RcSLDVVFmRW1M")).toBe(true);
    expect(runs("/")).toBe(true);
    expect(runs("/api/near/draft")).toBe(true);
    expect(runs("/api/transfers")).toBe(false);
    expect(runs("/api/health")).toBe(false);
    expect(runs("/brand/logo.svg")).toBe(false);
    expect(runs("/_next/static/chunks/app.js")).toBe(false);
    expect(runs("/chains/arc.webp")).toBe(false);
  });
});
