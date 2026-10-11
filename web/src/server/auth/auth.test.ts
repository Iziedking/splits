import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { finishSignIn, startSignIn } from "../services/signin";
import { testCtx } from "../testing";
import { consumeLoginCode, issueLoginCode, normaliseEmail } from "./otp";
import { assertPinShape, setInitialPin } from "./pin";
import { createSession, endSession, userForSession } from "./sessions";

describe("email sign-in", () => {
  it("normalises email and refuses junk", () => {
    expect(normaliseEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(() => normaliseEmail("not-an-email")).toThrow(AppError);
  });

  it("a code works once", async () => {
    const { ctx } = await testCtx();
    const code = await issueLoginCode(ctx.db, "ada@example.com", ctx.now());
    expect(await consumeLoginCode(ctx.db, "ada@example.com", code, ctx.now())).toBe(true);
    expect(await consumeLoginCode(ctx.db, "ada@example.com", code, ctx.now())).toBe(false);
  });

  it("five wrong guesses burn the code", async () => {
    const { ctx } = await testCtx();
    const code = await issueLoginCode(ctx.db, "ada@example.com", ctx.now());
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await consumeLoginCode(ctx.db, "ada@example.com", wrong, ctx.now())).toBe(false);
    expect(await consumeLoginCode(ctx.db, "ada@example.com", code, ctx.now())).toBe(false);
  });

  it("codes expire after ten minutes", async () => {
    const { ctx, clock } = await testCtx();
    const code = await issueLoginCode(ctx.db, "ada@example.com", ctx.now());
    clock.advance(11 * 60_000);
    expect(await consumeLoginCode(ctx.db, "ada@example.com", code, ctx.now())).toBe(false);
  });

  it("limits codes to five an hour per email", async () => {
    const { ctx } = await testCtx();
    for (let i = 0; i < 5; i++) await issueLoginCode(ctx.db, "ada@example.com", ctx.now());
    await expect(issueLoginCode(ctx.db, "ada@example.com", ctx.now())).rejects.toMatchObject({ code: "TOO_MANY_CODES" });
  });

  it("signing in creates an active user with a wallet, and is the same wallet next time", async () => {
    const { ctx } = await testCtx();
    const first = await finishSignIn(ctx, "ada@example.com", (await startSignIn(ctx, "ada@example.com")).previewCode!);
    const second = await finishSignIn(ctx, "ADA@example.com", (await startSignIn(ctx, "ada@example.com")).previewCode!);
    expect(first.user.status).toBe("active");
    expect(second.wallet.address).toBe(first.wallet.address);
  });

  it("live mode never returns the code", async () => {
    const { ctx } = await testCtx();
    const live = { ...ctx, mode: "live" as const };
    expect(await startSignIn(live, "ada@example.com")).toEqual({});
  });
});

describe("sessions", () => {
  it("resolve to the user until they end or expire", async () => {
    const { ctx, clock } = await testCtx();
    const { user } = await finishSignIn(ctx, "ada@example.com", (await startSignIn(ctx, "ada@example.com")).previewCode!);
    const s = await createSession(ctx.db, user.id, ctx.now());
    expect((await userForSession(ctx.db, s.token, ctx.now()))?.id).toBe(user.id);
    expect(await userForSession(ctx.db, s.token + "x", ctx.now())).toBeNull();
    await endSession(ctx.db, s.token);
    expect(await userForSession(ctx.db, s.token, ctx.now())).toBeNull();

    const s2 = await createSession(ctx.db, user.id, ctx.now());
    clock.advance(31 * 24 * 60 * 60_000);
    expect(await userForSession(ctx.db, s2.token, ctx.now())).toBeNull();
  });
});

describe("PIN", () => {
  it("must be six digits and not trivial", () => {
    for (const bad of ["12345", "1234567", "abcdef", "111111", "123456", "987654"]) {
      expect(() => assertPinShape(bad), bad).toThrow(AppError);
    }
    expect(() => assertPinShape("482913")).not.toThrow();
  });

  it("can only be set once through the setup route", async () => {
    const { ctx } = await testCtx();
    const { user } = await finishSignIn(ctx, "ada@example.com", (await startSignIn(ctx, "ada@example.com")).previewCode!);
    await setInitialPin(ctx.db, user.id, "482913");
    await expect(setInitialPin(ctx.db, user.id, "571920")).rejects.toMatchObject({ code: "PIN_ALREADY_SET" });
  });
});
