import { and, asc, eq, inArray, isNotNull, isNull, like, lt, ne, sql } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import type { Ctx } from "../context";
import { splitTags, users, wallets } from "../db/schema";
import { normaliseTag, showTag, TAG_CHANGES, tagFromPath, tagProblem } from "../domain/tags";
import { badRequest, conflict, isUniqueViolation, tooMany } from "../errors";
import { confirmAction, createAction, type Action, type Confirmation } from "./actions";
import { hitRateLimit } from "./rateLimits";
import { mainWallet, type User, type Wallet } from "./users";

const HOUR = 3_600_000;

export type TagCheck = { tag: string; status: "free" | "taken" | "format" | "reserved" };

const TAKEN = () => conflict("TAG_TAKEN", "Already taken");

/** A tag fit to be taken: valid, not reserved, never held by anyone. */
async function usable(ctx: Ctx, raw: string): Promise<string> {
  const tag = normaliseTag(raw);
  const problem = tagProblem(tag);
  if (problem === "format") throw badRequest("TAG_FORMAT", "3–20 letters, numbers or _");
  if (problem === "reserved") throw badRequest("TAG_RESERVED", "That tag isn't available");
  const [held] = await ctx.db.select({ tag: splitTags.tag }).from(splitTags).where(eq(splitTags.tag, tag)).limit(1);
  if (held) throw TAKEN();
  return tag;
}

/** Whether a tag could be taken right now. A retired tag counts as taken: it never comes back. */
export async function checkTag(ctx: Ctx, raw: string): Promise<TagCheck> {
  const tag = normaliseTag(raw);
  const problem = tagProblem(tag);
  if (problem) return { tag, status: problem };
  const [held] = await ctx.db.select({ tag: splitTags.tag }).from(splitTags).where(eq(splitTags.tag, tag)).limit(1);
  return { tag, status: held ? "taken" : "free" };
}

/**
 * An account's first tag. The row in split_tags goes in first: its primary key decides who gets a
 * tag two people ask for at once, and the loser is told it's taken rather than seeing an error.
 */
export async function claimTag(ctx: Ctx, user: User, raw: string): Promise<User> {
  if (user.tag) throw conflict("TAG_ALREADY_SET", "You already have a tag. Change it from Profile.");
  const tag = await usable(ctx, raw);
  return ctx.db.transaction(async (tx) => {
    try {
      await tx.insert(splitTags).values({ tag, userId: user.id, claimedAt: ctx.now() });
    } catch (err) {
      if (isUniqueViolation(err)) throw TAKEN();
      throw err;
    }
    const [updated] = await tx.update(users).set({ tag }).where(and(eq(users.id, user.id), isNull(users.tag))).returning();
    if (!updated) throw conflict("TAG_ALREADY_SET", "You already have a tag. Change it from Profile.");
    return updated;
  });
}

/** A change waits for the PIN, like a payment: it changes how people pay you. */
export async function startTagChange(ctx: Ctx, user: User, raw: string): Promise<{ action: Action; tag: string }> {
  if (!user.tag) throw conflict("NO_TAG", "Pick your tag first");
  if (user.tagChanges >= TAG_CHANGES) throw conflict("TAG_CHANGES_USED", "Your tag can't be changed again");
  const tag = await usable(ctx, raw);
  const action = await createAction(ctx, user.id, "change_tag", user.id, { from: showTag(user.tag), to: showTag(tag), tag });
  return { action, tag };
}

/** Confirms a change: the new tag is taken, the old one retired for good, one change used. */
export async function confirmTagChange(ctx: Ctx, user: User, actionId: string, proof: Confirmation): Promise<User> {
  const action = await confirmAction(ctx, user.id, actionId, proof, "change_tag", "This confirmation is for something else");
  const tag = String(action.summary.tag);
  return ctx.db.transaction(async (tx) => {
    // Locked first, so two changes confirmed at once are counted one after the other. Locking after
    // the insert deadlocks: each insert holds a key-share lock on this row through the foreign key.
    const [current] = await tx.select().from(users).where(eq(users.id, user.id)).for("update").limit(1);
    if (!current?.tag || current.tagChanges >= TAG_CHANGES) throw conflict("TAG_CHANGES_USED", "Your tag can't be changed again");
    try {
      await tx.insert(splitTags).values({ tag, userId: user.id, claimedAt: ctx.now() });
    } catch (err) {
      if (isUniqueViolation(err)) throw TAKEN();
      throw err;
    }
    await tx.update(splitTags).set({ retiredAt: ctx.now() }).where(eq(splitTags.tag, current.tag));
    const [updated] = await tx
      .update(users)
      .set({ tag, tagChanges: sql`${users.tagChanges} + 1` })
      .where(and(eq(users.id, user.id), eq(users.tag, current.tag), lt(users.tagChanges, TAG_CHANGES)))
      .returning();
    // Nothing matched: something changed underneath. Throwing rolls the new tag back, so it isn't burned.
    if (!updated) throw conflict("TAG_CHANGES_USED", "Your tag can't be changed again");
    return updated;
  });
}

/** The account a tag pays today, with its main wallet. Unknown, badly formed and retired tags pay nobody. */
export async function resolveTag(ctx: Ctx, raw: string): Promise<{ user: User; wallet: Wallet } | null> {
  const tag = normaliseTag(raw);
  if (tagProblem(tag) === "format") return null;
  const [user] = await ctx.db.select().from(users).where(eq(users.tag, tag)).limit(1);
  if (!user) return null;
  const wallet = await mainWallet(ctx, user.id);
  return wallet ? { user, wallet } : null;
}

/**
 * Tags starting with what a signed-in payer typed: 2 characters at least, 5 results at most,
 * never their own, never an email. Capped per person and in total, so it can't list everyone.
 */
export async function searchTags(ctx: Ctx, user: User, raw: string): Promise<string[]> {
  const q = normaliseTag(raw);
  if (q.length < 2) throw badRequest("QUERY_TOO_SHORT", "Type at least 2 characters");
  if (!(await hitRateLimit(ctx, `tags:search:u:${user.id}`, 60, HOUR)) || !(await hitRateLimit(ctx, "tags:search:all", 5000, HOUR))) {
    throw tooMany("TOO_MANY_SEARCHES", "Too many searches. Type the full tag instead.");
  }
  if (!/^[a-z0-9_]+$/.test(q)) return [];
  // "_" is a LIKE wildcard; escaped, it only matches itself.
  const rows = await ctx.db
    .select({ tag: users.tag })
    .from(users)
    .where(and(like(users.tag, `${q.replace(/[\\%_]/g, "\\$&")}%`), ne(users.id, user.id)))
    .orderBy(asc(users.tag))
    .limit(5);
  return rows.map((r) => r.tag!).filter(Boolean);
}

/**
 * The tag each address's holder uses today, keyed by lowercase address. Only main wallets: a tag
 * pays the main wallet, so a pocket or an outside address has none.
 */
export async function tagsByAddress(ctx: Ctx, addresses: string[]): Promise<Map<string, string>> {
  const valid = addresses.filter((a) => isAddress(a, { strict: false }));
  if (!valid.length) return new Map();
  // Both spellings, so the unique index on address is used whichever way it was stored.
  const spellings = [...new Set(valid.flatMap((a) => [getAddress(a), a.toLowerCase()]))];
  const rows = await ctx.db
    .select({ address: wallets.address, tag: users.tag })
    .from(wallets)
    .innerJoin(users, eq(users.id, wallets.userId))
    .where(and(eq(wallets.kind, "main"), inArray(wallets.address, spellings), isNotNull(users.tag)));
  return new Map(rows.map((r) => [r.address.toLowerCase(), r.tag!]));
}

/** What a tag's public page may show: the tag and nothing else about the person. Null pays nobody. */
export async function tagPageData(ctx: Ctx, raw: string): Promise<{ tag: string } | null> {
  const found = await resolveTag(ctx, tagFromPath(raw));
  return found ? { tag: found.user.tag! } : null;
}
