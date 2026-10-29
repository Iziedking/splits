import { describe, expect, it } from "vitest";
import { normaliseTag, showTag, suggestTag, tagProblem } from "./tags";

describe("Split tags", () => {
  it("normalise what people type", () => {
    expect(normaliseTag("@AdaKitchen ")).toBe("adakitchen");
    expect(normaliseTag("＠ada_k")).toBe("ada_k");
    expect(normaliseTag("ada")).toBe("ada");
    expect(showTag("ada")).toBe("@ada");
  });

  it("are 3 to 20 lowercase letters, numbers or underscores", () => {
    expect(tagProblem("ab")).toBe("format");
    expect(tagProblem("abc")).toBeNull();
    expect(tagProblem("a".repeat(20))).toBeNull();
    expect(tagProblem("a".repeat(21))).toBe("format");
    for (const t of ["ada.k", "ada-k", "ada k", "adé"]) expect(tagProblem(t)).toBe("format");
  });

  it("can't be a reserved word", () => {
    for (const t of ["support", "splits", "admin", "usdc"]) expect(tagProblem(t)).toBe("reserved");
  });

  it("are suggested from the email", () => {
    expect(suggestTag("Ada.Okafor@example.com")).toBe("ada_okafor");
    expect(tagProblem(suggestTag("x@y.co"))).toBeNull();
    expect(suggestTag(`${"a".repeat(40)}@example.com`)).toHaveLength(20);
    expect(tagProblem(suggestTag("support@example.com"))).toBeNull();
  });
});
