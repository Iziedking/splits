import { describe, expect, it } from "vitest";
import { localTimes } from "./api";

/** Server messages say "14:05 UTC"; people read their own time (fintech face WP6). */
describe("localTimes", () => {
  const now = new Date("2026-10-29T13:00:00Z");
  const local = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  it("turns a UTC time later today into the reader's local time", () => {
    const out = localTimes("More frees up at 14:05 UTC.", now);
    expect(out).toBe(`More frees up at ${local("2026-10-29T14:05:00Z")}.`);
    expect(out).not.toContain("UTC");
  });

  it("reads a time already past today as tomorrow's", () => {
    expect(localTimes("More at 00:00 UTC.", now)).toBe(`More at ${local("2026-10-30T00:00:00Z")}.`);
  });

  it("leaves text without a UTC time alone", () => {
    expect(localTimes("Nothing was sent.", now)).toBe("Nothing was sent.");
    expect(localTimes("Line 25:00 UTC is not a time", now)).toBe("Line 25:00 UTC is not a time");
  });
});
