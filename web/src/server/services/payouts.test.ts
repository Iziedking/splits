import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { signedInUser, testCtx } from "../testing";
import { checkPayout, claimDraft } from "./payouts";
import { mainWallet } from "./users";

const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);

async function setup(env: Record<string, string> = {}) {
  const { ctx, arc, clock } = await testCtx(env);
  const { user } = await signedInUser(ctx, "host@example.com");
  return { ctx, arc, clock, user };
}

describe("checking a payout list", () => {
  it("splits a pot equally, creates wallets for emails, and returns a draft", async () => {
    const { ctx, user } = await setup();
    const text = [addr(1), "winner@example.com", addr(2)].join("\n");
    const res = await checkPayout(ctx, user, { mode: "equal", text, pot: "10", label: "giveaway prize" });
    expect(res.ready).toBe(true);
    expect(res.total).toBe("10.00");
    expect(res.lines.map((l) => l.amount)).toEqual(["3.34", "3.33", "3.33"]);
    expect(res.lines.every((l) => l.status === "ready" && l.label === "giveaway prize")).toBe(true);
    expect(res.draft?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses per-line amounts and labels in each mode", async () => {
    const { ctx, user } = await setup();
    const res = await checkPayout(ctx, user, { mode: "each", text: `${addr(1)}, 50, 1st\n${addr(2)}, 30`, label: "prize" });
    expect(res.lines.map((l) => [l.amount, l.label])).toEqual([
      ["50.00", "1st"],
      ["30.00", "prize"],
    ]);
    expect(res.total).toBe("80.00");
  });

  it("flags bad, duplicate, self and blocklisted lines and blocks the draft", async () => {
    const { ctx, arc, user } = await setup();
    const me = (await mainWallet(ctx, user.id))!.address;
    arc.setBlocked(addr(9), true);
    const text = ["nope", addr(1), addr(1).toLowerCase(), "HOST@example.com", me, `${addr(9)}, 1`, `${addr(3)}, 1`].join("\n");
    const res = await checkPayout(ctx, user, { mode: "each", text, label: "prize" });
    expect(res.lines.map((l) => l.status)).toEqual(["invalid", "invalid", "duplicate", "self", "self", "cant_receive", "ready"]);
    expect(res.lines[1]!.message).toBe("Add an amount, like 5 or 2.50");
    expect(res.ready).toBe(false);
    expect(res.draft).toBeNull();
  });

  it("catches the same person named by email and by address", async () => {
    const { ctx, user } = await setup();
    const { user: bob } = await signedInUser(ctx, "bob@example.com");
    const bobAddress = (await mainWallet(ctx, bob.id))!.address;
    const res = await checkPayout(ctx, user, { mode: "each", text: `bob@example.com, 1
${bobAddress}, 1`, label: "prize" });
    expect(res.lines.map((l) => l.status)).toEqual(["ready", "duplicate"]);
    expect(res.draft).toBeNull();
  });

  it("says a line couldn't be checked when the network fails, instead of blaming the recipient", async () => {
    const { ctx, user } = await setup();
    ctx.chain.canReceive = async () => {
      throw new Error("RPC timed out");
    };
    const res = await checkPayout(ctx, user, { mode: "each", text: `${addr(1)}, 1`, label: "prize" });
    expect(res.lines[0]).toMatchObject({ status: "check_failed", message: "Couldn't check this line. Check again." });
    expect(res.ready).toBe(false);
  });

  it("refuses more recipients than MAX_PAYOUT_RECIPIENTS", async () => {
    const { ctx, user } = await setup({ MAX_PAYOUT_RECIPIENTS: "3" });
    const text = [1, 2, 3, 4].map(addr).join("\n");
    await expect(checkPayout(ctx, user, { mode: "equal", text, pot: "4", label: "x" })).rejects.toMatchObject({
      code: "TOO_MANY_RECIPIENTS",
    });
  });

  it("only lets the owner use an unexpired draft with the right hash", async () => {
    const { ctx, clock, user } = await setup();
    const { draft } = await checkPayout(ctx, user, { mode: "equal", text: addr(1), pot: "1", label: "x" });
    const other = (await signedInUser(ctx, "other@example.com")).user;
    await expect(claimDraft(ctx, other, draft!.id, draft!.hash)).rejects.toBeInstanceOf(AppError);
    await expect(claimDraft(ctx, user, draft!.id, "0".repeat(64))).rejects.toMatchObject({ code: "LIST_CHANGED" });
    clock.advance(31 * 60_000);
    await expect(claimDraft(ctx, user, draft!.id, draft!.hash)).rejects.toMatchObject({ code: "LIST_CHANGED" });
  });
});
