import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Qr, qrValueOk } from "./address-qr";
import { shareText, TagBlock, tagPageUrl } from "./tag-sheets";

const block = (changesLeft: number) => renderToStaticMarkup(<TagBlock tag="ada" changesLeft={changesLeft} onChange={() => {}} onQr={() => {}} />);

describe("the tag on Profile", () => {
  it("shows the tag, ways to share it, and the changes left", () => {
    const out = block(2);
    expect(out).toContain("@ada");
    expect(out).toContain("Share");
    expect(out).toContain("Show QR");
    expect(out).toContain("Change tag (2 of 3 left)");
  });

  it("says when the tag can't change again", () => {
    const out = block(0);
    expect(out).toContain("Your tag can&#x27;t be changed again");
    expect(out).not.toContain("Change tag (");
  });

  it("shares a plain line and the page link", () => {
    expect(shareText("ada")).toBe("Pay me on Splits: @ada");
    expect(tagPageUrl("https://mysplits.xyz/", "ada")).toBe("https://mysplits.xyz/@ada");
  });
});

describe("QR codes", () => {
  it("draw only an account address or a tag page link", () => {
    expect(qrValueOk("0x00000000000000000000000000000000000000f1")).toBe(true);
    expect(qrValueOk("https://mysplits.xyz/@ada")).toBe(true);
    expect(qrValueOk("http://127.0.0.1:3919/@ada_k")).toBe(true);
    for (const bad of ["https://evil.example/phish", "javascript:alert(1)", "https://mysplits.xyz/@a", "<svg>"]) expect(qrValueOk(bad)).toBe(false);
    expect(renderToStaticMarkup(<Qr value="https://evil.example/phish" label="x" />)).toBe("");
  });
});
