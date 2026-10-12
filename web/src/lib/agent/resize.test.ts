import { describe, expect, it } from "vitest";
import { fitWithin } from "./resize";

describe("fitWithin", () => {
  it("shrinks the long edge to the limit and keeps the shape", () => {
    expect(fitWithin(3136, 1000)).toEqual({ width: 1568, height: 500 });
    expect(fitWithin(1000, 3136)).toEqual({ width: 500, height: 1568 });
  });
  it("leaves small images alone", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
