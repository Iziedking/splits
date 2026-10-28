import { describe, expect, it } from "vitest";
import { otpCodes } from "../db/schema";
import { AppError } from "../errors";
import { finishSignIn, startSignIn } from "../services/signin";
import { signedInUser, TEST_PIN, testCtx } from "../testing";
import { consumeLoginCode, issueLoginCode, normaliseEmail } from "./otp";
import { assertPinShape, changePin, setInitialPin, verifyPin } from "./pin";
import { startPasskeyRegistration } from "./passkeys";
import { createSession, endOtherSessions, endSession, userForSession } from "./sessions";

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

  it("parallel guesses can't get past the five-attempt limit", async () => {
    const { ctx } = await testCtx();
    const code = await issueLoginCode(ctx.db, "ada@example.com", ctx.now());
    // Twenty wrong guesses fired together: each read can land before any count does, yet only five
    // may ever be checked, and after them the right code is refused too.
    const wrong = Array.from({ length: 20 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, "0"));
    expect(await Promise.all(wrong.map((c) => consumeLoginCode(ctx.db, "ada@example.com", c, ctx.now())))).not.toContain(true);
    const [row] = await ctx.db.select({ attempts: otpCodes.attempts }).from(otpCodes);
    expect(row!.attempts).toBe(5);
    expect(await consumeLoginCode(ctx.db, "ada@example.com", code, ctx.now())).toBe(false);
  });

  it("parallel code requests can't pass five an hour per email", async () => {
    const { ctx } = await testCtx();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => startSignIn(ctx, "ada@example.com")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
  });

  it("limits code emails per client IP and in total", async () => {
    const { ctx } = await testCtx({ SIGNIN_CODES_PER_IP_PER_HOUR: "3", SIGNIN_CODES_GLOBAL_PER_HOUR: "5" });
    for (let i = 0; i < 3; i++) await startSignIn(ctx, `p${i}@example.com`, "203.0.113.7");
    await expect(startSignIn(ctx, "p3@example.com", "203.0.113.7")).rejects.toMatchObject({ code: "TOO_MANY_CODES" });
    await startSignIn(ctx, "q0@example.com", "198.51.100.2");
    await expect(startSignIn(ctx, "q1@example.com", "198.51.100.3")).rejects.toMatchObject({ code: "TOO_MANY_CODES" });
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

  it("never returns the code when codes are emailed", async () => {
    const { ctx } = await testCtx();
    const live = { ...ctx, mode: "live" as const, showCodes: false };
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

describe("adding a passkey", () => {
  it("needs the PIN, so a stolen session can't add its own", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "key@example.com");
    await expect(startPasskeyRegistration(ctx.db, ctx.rp, user, "111111", ctx.now())).rejects.toMatchObject({ code: "PIN_WRONG" });
    const options = await startPasskeyRegistration(ctx.db, ctx.rp, user, TEST_PIN, ctx.now());
    expect(options.challenge).toBeTruthy();
  });

  it("needs a PIN to exist first", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "nopin@example.com", null);
    await expect(startPasskeyRegistration(ctx.db, ctx.rp, user, TEST_PIN, ctx.now())).rejects.toMatchObject({ code: "PIN_NOT_SET" });
  });
});

describe("signing out other sessions", () => {
  it("ends every session of the user except the one kept", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "many@example.com");
    const { user: other } = await signedInUser(ctx, "other@example.com");
    const [a, b, c] = [await createSession(ctx.db, user.id, ctx.now()), await createSession(ctx.db, user.id, ctx.now()), await createSession(ctx.db, other.id, ctx.now())];
    await endOtherSessions(ctx.db, user.id, a.token);
    expect((await userForSession(ctx.db, a.token, ctx.now()))?.id).toBe(user.id);
    expect(await userForSession(ctx.db, b.token, ctx.now())).toBeNull();
    expect((await userForSession(ctx.db, c.token, ctx.now()))?.id).toBe(other.id);
  });
});

describe("changing the PIN", () => {
  it("needs the current PIN, and the old one stops working", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "pin@example.com");
    await expect(changePin(ctx.db, user.id, "111111", "583920", ctx.now())).rejects.toMatchObject({ code: "PIN_WRONG" });
    await expect(changePin(ctx.db, user.id, TEST_PIN, "123456", ctx.now())).rejects.toMatchObject({ code: "PIN_TOO_SIMPLE" });
    await changePin(ctx.db, user.id, TEST_PIN, "583920", ctx.now());
    await expect(verifyPin(ctx.db, user.id, TEST_PIN, ctx.now())).rejects.toMatchObject({ code: "PIN_WRONG" });
    await verifyPin(ctx.db, user.id, "583920", ctx.now());
  });
});
