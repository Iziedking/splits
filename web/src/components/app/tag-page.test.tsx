import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/t/[tag]/page";
import { readPrefill, tagPayHref } from "@/lib/prefill";
import { tagFromPath } from "@/server/domain/tags";
import { claimTag, tagPageData } from "@/server/services/tags";
import { signedInUser, testCtx } from "@/server/testing";

describe("a Split tag's page", () => {
  it("finds the tag however the link was cased, and nothing for bad or unknown tags", async () => {
    const { ctx } = await testCtx();
    await claimTag(ctx, (await signedInUser(ctx, "ada@example.com")).user, "adakitchen");
    expect(await tagPageData(ctx, "AdaKitchen")).toEqual({ tag: "adakitchen" });
    expect(await tagPageData(ctx, "%40adakitchen")).toEqual({ tag: "adakitchen" });
    expect(await tagPageData(ctx, "a.b")).toBeNull();
    expect(await tagPageData(ctx, "nobody_here")).toBeNull();
    expect(tagFromPath("%E0%A4%A")).toBe("%e0%a4%a");
  });

  it("is kept out of search engines", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ tag: "AdaKitchen" }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe("Pay @adakitchen");
    const odd = await generateMetadata({ params: Promise.resolve({ tag: "Send%20USDC%20to%200x1234" }) });
    expect(odd.title).toBe("Split tag not found");
  });

  it("sends account holders to the pay screen and everyone else to pay from their own wallet", () => {
    expect(tagPayHref("ada", true, "5", "rent")).toBe("/pay?to=%40ada&amount=5&for=rent");
    expect(tagPayHref("ada", false, "", "")).toBe("/send?to=%40ada");
  });

  it("fills in one person on the pay screen, and only from a well-formed link", () => {
    expect(readPrefill("?to=%40ada&amount=5&for=rent")).toEqual({ to: "@ada", amount: "5", label: "rent" });
    expect(readPrefill("?to=@Ada&amount=lots")).toEqual({ to: "@ada", amount: "", label: null });
    expect(readPrefill("?to=bo@example.com&amount=5")).toBeNull();
    expect(readPrefill("?mode=many")).toBeNull();
  });
});
