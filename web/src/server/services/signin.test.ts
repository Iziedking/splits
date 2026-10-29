import { describe, expect, it } from "vitest";
import { testCtx } from "../testing";
import { finishSignIn, startSignIn } from "./signin";
import { ensureRecipientWallet, ensureUser } from "./users";
import { setInitialPin } from "../auth/pin";

async function signIn(ctx: Awaited<ReturnType<typeof testCtx>>["ctx"], email: string) {
  const { previewCode } = await startSignIn(ctx, email);
  return finishSignIn(ctx, email, previewCode!);
}

describe("finishing sign-in", () => {
  it("says whether the account is new", async () => {
    const { ctx } = await testCtx();
    const first = await signIn(ctx, "ada@example.com");
    expect(first.isNew).toBe(true);
    // Signed in once but never set a PIN: still setting up, so still new.
    expect((await signIn(ctx, "ada@example.com")).isNew).toBe(true);
    await setInitialPin(ctx.db, first.user.id, "482913");
    expect((await signIn(ctx, "ada@example.com")).isNew).toBe(false);
  });

  it("treats someone who was paid by email but never signed in as new, with their wallet kept", async () => {
    const { ctx } = await testCtx();
    const waiting = await ensureRecipientWallet(ctx, "bo@example.com", "u:test");
    expect((await ensureUser(ctx, "bo@example.com", "invited")).status).toBe("invited");
    const res = await signIn(ctx, "bo@example.com");
    expect(res.isNew).toBe(true);
    expect(res.wallet.id).toBe(waiting!.id);
    expect(res.user.status).toBe("active");
  });
});
