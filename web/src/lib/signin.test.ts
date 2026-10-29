import { describe, expect, it } from "vitest";
import { afterCode, ALREADY_HAVE, NEW_HERE } from "./signin";

const fresh = { isNew: true, hasPin: false, needsTag: true };
const tagless = { isNew: false, hasPin: true, needsTag: true };
const done = { isNew: false, hasPin: true, needsTag: false };

describe("after the sign-in code", () => {
  it("Get started", () => {
    expect(afterCode("start", fresh)).toEqual({ notice: null, to: "/setup" });
    expect(afterCode("start", done)).toEqual({ notice: ALREADY_HAVE, to: "/home" });
    expect(afterCode("start", tagless)).toEqual({ notice: ALREADY_HAVE, to: "/setup" });
  });

  it("I already have an account", () => {
    expect(afterCode("signin", fresh)).toEqual({ notice: NEW_HERE, to: "/setup" });
    expect(afterCode("signin", tagless)).toEqual({ notice: null, to: "/setup" });
    expect(afterCode("signin", done)).toEqual({ notice: null, to: "/home" });
  });
});
