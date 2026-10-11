import { describe, expect, it } from "vitest";
import { clientIp } from "./visitor";

describe("visitor IP", () => {
  const headers = (xff: string) => new Headers({ "x-forwarded-for": xff });

  it("takes the hop our own proxy appended, not one the client wrote", () => {
    expect(clientIp(headers("1.2.3.4, 203.0.113.7"), true)).toBe("203.0.113.7");
    expect(clientIp(headers("203.0.113.7"), true)).toBe("203.0.113.7");
  });

  it("ignores the header unless the server is behind our proxy", () => {
    expect(clientIp(headers("203.0.113.7"), false)).toBeNull();
    expect(clientIp(new Headers(), true)).toBeNull();
  });
});
