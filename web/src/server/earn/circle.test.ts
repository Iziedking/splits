import { describe, expect, it } from "vitest";
import { noPositionYet } from "./circle";

describe("live Earn Kit", () => {
  it("reads 'no position yet' as an empty position, and any other error as an error", () => {
    const notRegistered = Object.assign(new Error("The requested wallet/vault position is not registered."), {
      cause: { trace: { earnServiceCode: 380407 } },
    });
    expect(noPositionYet(notRegistered)).toBe(true);
    expect(noPositionYet(new Error("The requested wallet/vault position is not registered."))).toBe(true);
    expect(noPositionYet(Object.assign(new Error("Rate limited"), { cause: { trace: { earnServiceCode: 429 } } }))).toBe(false);
    expect(noPositionYet(null)).toBe(false);
  });
});
