import { describe, expect, it } from "vitest";
import { parsePayoutLines } from "../domain/payouts";
import { agentDraftSchema, cleanAmount, cutBytes, NothingFound, toComposer, type AgentDraft } from "./draft";

const A1 = "0x00000000000000000000000000000000000000a1";
const A2 = "0x00000000000000000000000000000000000000a2";

const draft = (over: Partial<AgentDraft>): AgentDraft => ({ split: "each", pot: null, label: null, lines: [], notes: [], ...over });

describe("cleanAmount", () => {
  it("reads common ways people write amounts, exactly", () => {
    expect(cleanAmount("75")).toBe("75.00");
    expect(cleanAmount("$1,250.5 USDC")).toBe("1250.50");
    expect(cleanAmount("12.50")).toBe("12.50");
    expect(cleanAmount("0.10")).toBe("0.10");
    expect(cleanAmount("3.000")).toBe("3.00");
  });
  it("refuses what isn't a positive amount in whole cents", () => {
    for (const bad of ["0", "0.00", "-5", "abc", "1.005", "", "1e3"]) expect(cleanAmount(bad)).toBeNull();
  });
});

describe("cutBytes", () => {
  it("cuts at 31 bytes without splitting a character", () => {
    expect(cutBytes("a".repeat(40))).toBe("a".repeat(31));
    const cut = cutBytes("ééééééééééééééééé"); // 2 bytes each
    expect(new TextEncoder().encode(cut).length).toBe(30);
  });
});

describe("toComposer", () => {
  it("notes that an @name will be paid as a Split tag, not a social handle", () => {
    const fill = toComposer(draft({ lines: [{ who: "@ada", amount: "5", purpose: null }] }), 50);
    expect(fill.notes).toContain("Line 1: @ada will be paid as the Splits account @ada, not a social media handle");
  });

  it("writes set amounts as who, amount, purpose lines that the list check reads back exactly", () => {
    const fill = toComposer(
      draft({
        label: "Prizes",
        lines: [
          { who: "Ada@Example.com", amount: "$50", purpose: "1st place" },
          { who: A1, amount: "30", purpose: null },
          { who: A2, amount: "20.5", purpose: "3rd, runner up" },
        ],
      }),
      50,
    );
    expect(fill.mode).toBe("each");
    expect(fill.label).toBe("Prizes");
    const parsed = parsePayoutLines(fill.text);
    expect(parsed.map((p) => [p.problem, p.amount, p.label])).toEqual([
      [null, 50_000_000n, "1st place"],
      [null, 30_000_000n, null],
      [null, 20_500_000n, "3rd runner up"],
    ]);
    expect(parsed[0]!.target).toEqual({ type: "email", email: "ada@example.com" });
  });

  it("leaves amounts out of an equal split and keeps the pot", () => {
    const fill = toComposer(draft({ split: "equal", pot: "300", lines: [{ who: A1, amount: "100", purpose: "gift" }, { who: A2, amount: null, purpose: null }] }), 50);
    expect(fill).toMatchObject({ mode: "equal", pot: "300.00", text: `${A1}, , gift\n${A2}` });
  });

  it("passes a wrong address through so the list check flags that line (Review Focus 2)", () => {
    const short = "0x00000000000000000000000000000000000000a"; // 39 hex characters
    const typo = "0xAbCdEf0000000000000000000000000000000000";
    const fill = toComposer(draft({ lines: [{ who: short, amount: "1", purpose: null }, { who: typo, amount: "1", purpose: null }] }), 50);
    expect(parsePayoutLines(fill.text).map((p) => p.problem)).toEqual([
      "Not an email or an Arc address",
      "This address has a typo. Copy it again from the source.",
    ]);
  });

  it("drops a bad amount with a note, and cuts long labels with a note", () => {
    const fill = toComposer(draft({ label: "x".repeat(40), lines: [{ who: A1, amount: "lots", purpose: "p".repeat(40) }] }), 50);
    expect(fill.text).toBe(`${A1}, , ${"p".repeat(31)}`);
    expect(fill.label).toBe("x".repeat(31));
    expect(fill.notes).toEqual([
      'Line 1: "lots" isn\'t an amount in whole cents, so it was left out',
      "Line 1: the label was shortened to fit 31 characters",
      "The label for everyone was shortened to fit 31 characters",
    ]);
  });

  it("skips empty lines and renumbers the model's notes to match", () => {
    const fill = toComposer(
      draft({
        lines: [
          { who: "  ", amount: "1", purpose: null },
          { who: A1, amount: "2", purpose: null },
        ],
        notes: [
          { line: 2, text: "the last 4 characters were hard to read" },
          { line: 1, text: "about the blank line" },
        ],
      }),
      50,
    );
    expect(fill.text).toBe(`${A1}, 2.00`);
    expect(fill.notes).toEqual(["Line 1: the last 4 characters were hard to read"]);
  });

  it("drops notes for missing lines and cuts long ones (Review Focus 3)", () => {
    const fill = toComposer(
      draft({
        lines: [{ who: A1, amount: "2", purpose: null }],
        notes: [
          { line: 0, text: "zero" },
          { line: 9, text: "nine" },
          { line: null, text: "y".repeat(5000) },
          { line: null, text: "   " },
        ],
      }),
      50,
    );
    expect(fill.notes).toEqual(["y".repeat(200)]);
  });

  it("keeps the first lines up to the cap and says so", () => {
    const lines = Array.from({ length: 4 }, (_, i) => ({ who: `p${i}@example.com`, amount: "1", purpose: null }));
    const fill = toComposer(draft({ lines }), 3);
    expect(fill.text.split("\n")).toHaveLength(3);
    expect(fill.notes).toContain("Only the first 3 fit in one payment");
  });

  it("never drops the cap note, however many other notes there are", () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ who: `p${i}@example.com`, amount: i < 25 ? "lots" : "1", purpose: null }));
    const fill = toComposer(draft({ lines }), 50);
    expect(fill.notes).toHaveLength(20);
    expect(fill.notes[0]).toBe("Only the first 50 fit in one payment");
  });

  it("cuts notes without splitting a character", () => {
    const fill = toComposer(draft({ lines: [{ who: A1, amount: "2", purpose: null }], notes: [{ line: null, text: `${"a".repeat(199)}😀 and more` }] }), 50);
    expect(fill.notes[0]).toBe(`${"a".repeat(199)}😀`);
  });

  it("accepts a heavily noted answer and keeps 20 notes, instead of refusing it", () => {
    const notes = Array.from({ length: 60 }, (_, i) => ({ line: 1, text: `note ${i}` }));
    const parsed = agentDraftSchema.parse({ split: "each", pot: null, label: null, lines: [{ who: A1, amount: "1", purpose: null }], notes });
    expect(toComposer(parsed, 50).notes).toHaveLength(20);
  });

  it("refuses a draft with nobody to pay", () => {
    expect(() => toComposer(draft({ lines: [{ who: " ", amount: null, purpose: null }] }), 50)).toThrow(NothingFound);
  });

  it("keeps only the composer's fields, whatever else the model sends", () => {
    const parsed = agentDraftSchema.parse({
      split: "each",
      pot: null,
      label: null,
      lines: [{ who: A1, amount: "1", purpose: null, pay: true }],
      notes: [],
      transfer: "0xEvil",
    });
    expect(Object.keys(toComposer(parsed, 50)).sort()).toEqual(["label", "mode", "notes", "pot", "text"]);
    expect(JSON.stringify(parsed)).not.toContain("0xEvil");
  });
});
