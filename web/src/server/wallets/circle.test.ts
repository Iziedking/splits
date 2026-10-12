import { describe, expect, it } from "vitest";
import { inboundStateOk } from "./circle";

describe("which inbound transfers count", () => {
  it("counts only finished transfers for Arc activity", () => {
    expect(inboundStateOk("COMPLETE", false)).toBe(true);
    expect(inboundStateOk("COMPLETED", false)).toBe(true);
    expect(inboundStateOk("CONFIRMED", false)).toBe(false);
  });

  it("also counts confirmed ones for deposits, which are checked on chain anyway", () => {
    expect(inboundStateOk("CONFIRMED", true)).toBe(true);
    expect(inboundStateOk("COMPLETE", true)).toBe(true);
    for (const s of ["INITIATED", "QUEUED", "SENT", "FAILED", "CANCELLED", "DENIED", undefined]) expect(inboundStateOk(s, true)).toBe(false);
  });
});
