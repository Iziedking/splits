import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TAG_STATUS, TagField, TagPicker } from "./tag-picker";

const field = (status: Parameters<typeof TagField>[0]["status"], value = "adakitchen") =>
  renderToStaticMarkup(<TagField value={value} status={status} onChange={() => {}} />);

describe("picking a Split tag", () => {
  it("explains itself and offers the suggestion", () => {
    const out = renderToStaticMarkup(<TagPicker suggestion="ada_okafor" onClaimed={() => {}} />);
    expect(out).toContain("Pick your Split tag");
    expect(out).toContain("People can pay you with your tag instead of your email.");
    expect(out).toContain("You can change it 3 times.");
    expect(out).toContain('value="ada_okafor"');
    expect(out).toContain("Use @ada_okafor");
  });

  it("keeps the @ outside the field", () => {
    const out = field(null);
    expect(out).toMatch(/<span[^>]*aria-hidden="true"[^>]*>@<\/span><input/);
  });

  it("says plainly whether the tag can be had", () => {
    expect(field("free")).toContain("@adakitchen is yours to take");
    expect(field("taken")).toContain("Already taken");
    expect(field("format")).toContain("3–20 letters, numbers or _");
    expect(field("reserved")).toContain("That tag isn&#x27;t available");
    expect(field("free")).toContain('role="status"');
    expect(TAG_STATUS.free("x")).toBe("@x is yours to take");
  });

  it("offers the button only for a free tag", () => {
    // Before any answer from the server, the button waits.
    expect(renderToStaticMarkup(<TagPicker suggestion="ada" onClaimed={() => {}} />)).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Use @ada/);
  });
});
