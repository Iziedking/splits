import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Ctx } from "../context";
import { splitTags, users } from "../db/schema";
import { AppError } from "../errors";
import { signedInUser, TEST_PIN, testCtx } from "../testing";
import { userView } from "../views";
import { checkTag, claimTag, confirmTagChange, resolveTag, searchTags, startTagChange } from "./tags";
import type { User } from "./users";

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return "OK";
}

async function person(ctx: Ctx, email: string) {
  return (await signedInUser(ctx, email)).user;
}

async function change(ctx: Ctx, user: User, tag: string, pin = TEST_PIN) {
  const { action } = await startTagChange(ctx, user, tag);
  return confirmTagChange(ctx, user, action.id, { pin });
}

const fresh = async (ctx: Ctx, id: string) => (await ctx.db.select().from(users).where(eq(users.id, id)))[0]!;

describe("taking a tag", () => {
  it("checks whether a tag is free", async () => {
    const { ctx } = await testCtx();
    const ada = await person(ctx, "ada@example.com");
    await claimTag(ctx, ada, "@Ada");
    expect(await checkTag(ctx, "ADA")).toEqual({ tag: "ada", status: "taken" });
    expect(await checkTag(ctx, "bola")).toEqual({ tag: "bola", status: "free" });
    expect(await checkTag(ctx, "support")).toEqual({ tag: "support", status: "reserved" });
    expect(await checkTag(ctx, "a.b")).toEqual({ tag: "a.b", status: "format" });
  });

  it("takes a tag once, and only when the account has none", async () => {
    const { ctx } = await testCtx();
    const ada = await person(ctx, "ada@example.com");
    const bo = await person(ctx, "bo@example.com");
    const tagged = await claimTag(ctx, ada, "ada");
    expect(tagged.tag).toBe("ada");
    expect(await code(claimTag(ctx, bo, "ada"))).toBe("TAG_TAKEN");
    expect(await code(claimTag(ctx, tagged, "ada2"))).toBe("TAG_ALREADY_SET");
    expect(await code(claimTag(ctx, bo, "support"))).toBe("TAG_RESERVED");
    expect(await code(claimTag(ctx, bo, "b"))).toBe("TAG_FORMAT");
  });

  it("two people taking one tag at once: exactly one gets it", async () => {
    const { ctx } = await testCtx();
    const ada = await person(ctx, "ada@example.com");
    const bo = await person(ctx, "bo@example.com");
    const results = await Promise.all([code(claimTag(ctx, ada, "same")), code(claimTag(ctx, bo, "same"))]);
    expect(results.sort()).toEqual(["OK", "TAG_TAKEN"]);
    expect(await ctx.db.select().from(splitTags).where(eq(splitTags.tag, "same"))).toHaveLength(1);
  });
});

describe("changing a tag", () => {
  it("needs the PIN, retires the old tag, and counts", async () => {
    const { ctx } = await testCtx();
    const ada = await claimTag(ctx, await person(ctx, "ada@example.com"), "ada");
    expect(await code(change(ctx, ada, "ada_new", "000000"))).not.toBe("OK");
    expect((await fresh(ctx, ada.id)).tag).toBe("ada");

    const changed = await change(ctx, ada, "ada_new");
    expect(changed).toMatchObject({ tag: "ada_new", tagChanges: 1 });
    const [old] = await ctx.db.select().from(splitTags).where(eq(splitTags.tag, "ada"));
    expect(old!.retiredAt).not.toBeNull();
  });

  it("allows 3 changes in a lifetime", async () => {
    const { ctx } = await testCtx();
    let ada = await claimTag(ctx, await person(ctx, "ada@example.com"), "ada");
    for (const t of ["ada_b", "ada_c", "ada_d"]) ada = await change(ctx, ada, t);
    expect(ada.tagChanges).toBe(3);
    expect(await code(startTagChange(ctx, ada, "ada_e"))).toBe("TAG_CHANGES_USED");
  });

  it("never gives a retired tag to anyone, its last holder included", async () => {
    const { ctx } = await testCtx();
    const ada = await change(ctx, await claimTag(ctx, await person(ctx, "ada@example.com"), "ada"), "ada_new");
    const bo = await person(ctx, "bo@example.com");
    expect(await checkTag(ctx, "ada")).toEqual({ tag: "ada", status: "taken" });
    expect(await code(claimTag(ctx, bo, "ada"))).toBe("TAG_TAKEN");
    expect(await code(startTagChange(ctx, ada, "ada"))).toBe("TAG_TAKEN");
    expect(await resolveTag(ctx, "ada")).toBeNull();
    expect((await resolveTag(ctx, "@Ada_New"))!.user.id).toBe(ada.id);
  });
});

describe("changing a tag twice at once", () => {
  it("counts every change and leaves exactly one tag in use", async () => {
    const { ctx } = await testCtx();
    const ada = await claimTag(ctx, await person(ctx, "ada@example.com"), "ada");
    const a = await startTagChange(ctx, ada, "ada_a");
    const b = await startTagChange(ctx, ada, "ada_b");
    const results = await Promise.all([
      confirmTagChange(ctx, ada, a.action.id, { pin: TEST_PIN }).then(() => "OK", (e) => (e instanceof AppError ? e.code : "500")),
      confirmTagChange(ctx, ada, b.action.id, { pin: TEST_PIN }).then(() => "OK", (e) => (e instanceof AppError ? e.code : "500")),
    ]);
    expect(results).not.toContain("500");
    const now = await fresh(ctx, ada.id);
    const held = await ctx.db.select().from(splitTags).where(eq(splitTags.userId, ada.id));
    // Every tag this account ever took but one is retired, and each retirement was a counted change.
    expect(held.filter((t) => !t.retiredAt).map((t) => t.tag)).toEqual([now.tag]);
    expect(now.tagChanges).toBe(held.length - 1);
  });

  it("refuses a change past the third with a 409, and keeps that tag free", async () => {
    const { ctx } = await testCtx();
    let ada = await claimTag(ctx, await person(ctx, "ada@example.com"), "ada");
    ada = await change(ctx, ada, "ada_1");
    ada = await change(ctx, ada, "ada_2");
    const last = await startTagChange(ctx, ada, "ada_3");
    const extra = await startTagChange(ctx, ada, "ada_4");
    await confirmTagChange(ctx, ada, last.action.id, { pin: TEST_PIN });
    expect(await code(confirmTagChange(ctx, ada, extra.action.id, { pin: TEST_PIN }))).toBe("TAG_CHANGES_USED");
    expect(await checkTag(ctx, "ada_4")).toEqual({ tag: "ada_4", status: "free" });
  });
});

describe("finding tags", () => {
  it("resolves current tags to the holder and their main wallet", async () => {
    const { ctx } = await testCtx();
    const ada = await claimTag(ctx, await person(ctx, "ada@example.com"), "ada");
    const found = await resolveTag(ctx, "＠ADA");
    expect(found!.user.id).toBe(ada.id);
    expect(found!.wallet.kind).toBe("main");
    expect(await resolveTag(ctx, "nobody")).toBeNull();
    expect(await resolveTag(ctx, "a.b")).toBeNull();
  });

  it("searches by the start of a tag, at most 5, never the searcher, never an email", async () => {
    const { ctx } = await testCtx();
    const me = await claimTag(ctx, await person(ctx, "me@example.com"), "adame");
    for (let i = 0; i < 7; i++) await claimTag(ctx, await person(ctx, `a${i}@example.com`), `ada_${i}`);
    await claimTag(ctx, await person(ctx, "x@example.com"), "kada");
    const found = await searchTags(ctx, me, "@AD");
    expect(found).toHaveLength(5);
    expect(found.every((t) => t.startsWith("ad"))).toBe(true);
    expect(found).not.toContain("adame");
    expect(JSON.stringify(found)).not.toContain("@example.com");
    expect(await code(searchTags(ctx, me, "a"))).toBe("QUERY_TOO_SHORT");
  });

  it("matches an underscore only as an underscore", async () => {
    const { ctx } = await testCtx();
    const me = await claimTag(ctx, await person(ctx, "me@example.com"), "zz_me");
    await claimTag(ctx, await person(ctx, "a@example.com"), "ab_c");
    await claimTag(ctx, await person(ctx, "b@example.com"), "abxc");
    expect(await searchTags(ctx, me, "ab_")).toEqual(["ab_c"]);
    expect(await searchTags(ctx, me, "__")).toEqual([]);
  });

  it("limits searches to 60 an hour per person", async () => {
    const { ctx } = await testCtx();
    const me = await claimTag(ctx, await person(ctx, "me@example.com"), "me_me");
    for (let i = 0; i < 60; i++) await searchTags(ctx, me, "ab");
    expect(await code(searchTags(ctx, me, "ab"))).toBe("TOO_MANY_SEARCHES");
  });
});

describe("the account view", () => {
  it("says whether a tag is still needed and how many changes are left", async () => {
    const { ctx } = await testCtx();
    const ada = await person(ctx, "ada@example.com");
    expect(userView(ada, false)).toMatchObject({ tag: null, needsTag: true, tagChangesLeft: 3 });
    const tagged = await change(ctx, await claimTag(ctx, ada, "ada"), "ada_b");
    expect(userView(tagged, false)).toMatchObject({ tag: "ada_b", needsTag: false, tagChangesLeft: 2 });
  });
});
