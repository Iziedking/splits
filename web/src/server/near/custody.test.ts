import { describe, expect, it } from "vitest";
import { base58, userAccountId, userKeyPair } from "./custody";

const SECRET = "11".repeat(32);

describe("email account keys", () => {
  it("are the same for the same person, and different between people", () => {
    const a = userKeyPair("user-a", SECRET).getPublicKey().toString();
    expect(userKeyPair("user-a", SECRET).getPublicKey().toString()).toBe(a);
    expect(userKeyPair("user-b", SECRET).getPublicKey().toString()).not.toBe(a);
    expect(userKeyPair("user-a", "22".repeat(32)).getPublicKey().toString()).not.toBe(a);
    expect(a).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });

  it("sign with the key they say they have", () => {
    const kp = userKeyPair("user-a", SECRET);
    const msg = new TextEncoder().encode("hello");
    const { signature } = kp.sign(msg);
    expect(kp.verify(msg, signature)).toBe(true);
  });

  it("name a short sub-account of the app account", () => {
    expect(userAccountId("user-a", "splits-app.testnet")).toMatch(/^u-[0-9a-f]{10}\.splits-app\.testnet$/);
  });

  it("write base58 the way NEAR does", () => {
    expect(base58(new Uint8Array([0, 0, 1]))).toBe("112");
    expect(base58(new TextEncoder().encode("hello world"))).toBe("StV1DL6CwTryKyV");
  });
});
