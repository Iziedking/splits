import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayoutComposer } from "./payout-composer";
import { applyTag, tagQueryAt, TagOptions } from "./tag-suggest";

describe("suggesting tags while paying", () => {
  it("searches only once 2 characters follow the @", () => {
    expect(tagQueryAt("@a", 2)).toBeNull();
    expect(tagQueryAt("@Ad", 3)).toBe("ad");
    expect(tagQueryAt("ada@example.com", 15)).toBeNull();
  });

  it("works on the line being typed in a list, and not after its comma", () => {
    const text = "bo@example.com, 5\n@ada, 3\n@ke";
    expect(tagQueryAt(text, text.length)).toBe("ke");
    expect(tagQueryAt(text, 22)).toBe("ada");
    expect(tagQueryAt(text, 25)).toBeNull();
  });

  it("replaces only the tag being typed, keeping the rest of the line", () => {
    expect(applyTag("@ad", 3, "adakitchen")).toBe("@adakitchen");
    const text = "bo@example.com, 5\n@ad, 3, cake\nzed@example.com";
    expect(applyTag(text, 21, "adakitchen")).toBe("bo@example.com, 5\n@adakitchen, 3, cake\nzed@example.com");
  });

  it("shows at most 5 tags", () => {
    const out = renderToStaticMarkup(<TagOptions tags={["a1", "a2", "a3", "a4", "a5", "a6"]} onPick={() => {}} />);
    expect(out.match(/<button/g)).toHaveLength(5);
    expect(out).toContain("@a1");
    expect(renderToStaticMarkup(<TagOptions tags={[]} onPick={() => {}} />)).toBe("");
  });

  it("tells account holders and visitors that tags work", () => {
    expect(renderToStaticMarkup(<PayoutComposer mode="one" initialLabel="" onChecked={() => {}} />)).toContain("Email or @tag");
    expect(renderToStaticMarkup(<PayoutComposer mode="one" initialLabel="" onChecked={() => {}} vocabulary="wallet" />)).toContain("Email, @tag or Arc address");
  });
});

describe("tag lines in the check", () => {
  it("say the tag is a Splits account, not a social handle", async () => {
    const { ReviewTable } = await import("./review-table");
    const check = {
      lines: [{ line: 1, raw: "@ada, 5", recipient: "@ada", amount: "5.00", label: "prize", status: "ready", message: null }],
      total: "5.00", ready: true, totalUnits: "5000000", fee: "0.00", feePercent: 0, charge: "5.00", maxRecipients: 50, draft: null,
    } as unknown as Parameters<typeof ReviewTable>[0]["check"];
    expect(renderToStaticMarkup(<ReviewTable check={check} />)).toContain("Splits account @ada");
  });
});
