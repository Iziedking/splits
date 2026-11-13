/**
 * "Watch a payment divide" on the landing page: one click sends a real $1.00 of test USDC on NEAR
 * testnet from a demo payer to a demo person whose saved split is 30% tax, 20% savings, 50% spending.
 * Both are email-style accounts the server signs for; the app account relays and pays the gas.
 *
 * Nothing drains: the money circles. When the payer runs low, the person's three accounts send what
 * they received back to it. The app account keeps the pool at 10 test USDC, so a refill (and its
 * short wait for a quick second click) comes about once in ten payments.
 * Limits: 3 per visitor per hour, 30 an hour in all, 120 a day in all, one at a time.
 */
import { newRef, gasFor, splitsEvents, verifyPayment } from "@/lib/near/payment";
import { NEAR } from "@/lib/near/config";
import type { Ctx } from "../context";
import { tooMany, badRequest } from "../errors";
import { hitRateLimit, refundRateHit } from "../services/rateLimits";
import { appAccountId, appSendUsdc, ensureNearAccount, relayAs, savedSplitOf, usdcBalance, userAccountId } from "./custody";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const TGAS = 10n ** 12n;

export const LIVE_DEMO = {
  amountUnits: 1_000_000n, // $1.00 of test USDC
  perVisitorPerHour: 3,
  perHour: 30,
  perDay: 120,
  poolUnits: 10_000_000n, // what the payer holds after a refill
} as const;

const PAYER = "splits-live-demo-payer";
const PERSON = "splits-live-demo-person";
export const demoPayer = () => userAccountId(PAYER);
export const demoPerson = () => userAccountId(PERSON);

const SPLIT = (person: string) => [
  { account_id: `tax.${person}`, bps: 3000, purpose: "Tax" },
  { account_id: `savings.${person}`, bps: 2000, purpose: "Savings" },
  { account_id: person, bps: 5000, purpose: "Spending" },
];

export type LiveDemoResult = { hash: string; total: string; legs: { purpose: string; amount: string; landed: boolean }[] };

let readyVersion: number | null = null;
async function ensureReady(ctx: Ctx): Promise<number> {
  if (readyVersion !== null) return readyVersion;
  const payer = await ensureNearAccount(ctx, PAYER);
  const person = await ensureNearAccount(ctx, PERSON);
  const want = SPLIT(person);
  const split = await savedSplitOf(person);
  const same = split && split.shares.length === 3 && want.every((w, i) => split.shares[i]?.account_id === w.account_id && split.shares[i]?.bps === w.bps && split.shares[i]?.purpose === w.purpose);
  if (!same) {
    await relayAs(PERSON, person, NEAR.router, [{ methodName: "set_split", args: { shares: want }, gas: 30n * TGAS, deposit: 10_000_000_000_000_000_000_000n }]);
  }
  if ((await usdcBalance(payer)) < LIVE_DEMO.amountUnits) await refill(payer, person);
  const saved = await savedSplitOf(person);
  if (!saved) throw badRequest("LIVE_DEMO_NOT_READY", "The demo is not ready yet. Try again in a minute.");
  readyVersion = saved.version;
  return readyVersion;
}

/** Brings the person's test money back to the payer, and has the app account fill the pool up to `poolUnits`. */
async function refill(payer: string, person: string) {
  for (const from of [person, `tax.${person}`, `savings.${person}`]) {
    const units = await usdcBalance(from);
    if (units <= 0n) continue;
    await relayAs(PERSON, from, NEAR.token, [{ methodName: "ft_transfer", args: { receiver_id: payer, amount: units.toString(), memo: "Splits live demo: back to the payer" }, gas: 30n * TGAS, deposit: 1n }]);
  }
  const have = await usdcBalance(payer);
  if (have < LIVE_DEMO.poolUnits) {
    const need = LIVE_DEMO.poolUnits - have;
    if ((await usdcBalance(appAccountId())) >= need) {
      await appSendUsdc(payer, need, "Splits live demo (test money, no value)");
    } else if (have < LIVE_DEMO.amountUnits) {
      throw tooMany("LIVE_DEMO_EMPTY", "The demo has run out of test money for now. Try again later.");
    }
  }
}

let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function limit(ctx: Ctx, key: string, max: number, windowMs: number, message: string) {
  if (!(await hitRateLimit(ctx, key, max, windowMs))) throw tooMany("LIVE_DEMO_LIMIT", message);
}

export async function runLiveDemo(ctx: Ctx, ip: string): Promise<LiveDemoResult> {
  await limit(ctx, `near:livedemo:ip:${ip}`, LIVE_DEMO.perVisitorPerHour, HOUR, "You have watched three payments this hour. Try again later.");
  await limit(ctx, "near:livedemo:hour", LIVE_DEMO.perHour, HOUR, "The demo is busy this hour. Try again in a little while.");
  await limit(ctx, "near:livedemo:day", LIVE_DEMO.perDay, DAY, "The demo has reached today's limit. Try again tomorrow.");
  try {
    const result = await oneAtATime(() => pay(ctx));
    // Get the payer ready for the next visitor now, so nobody waits for the refill.
    void oneAtATime(topUpIfLow).catch(() => undefined);
    return result;
  } catch (e) {
    // Nothing was paid, so the visitor keeps this try.
    await refundRateHit(ctx, `near:livedemo:ip:${ip}`, HOUR);
    throw e;
  }
}

async function topUpIfLow() {
  const payer = demoPayer();
  if ((await usdcBalance(payer)) < LIVE_DEMO.amountUnits) await refill(payer, demoPerson());
}

async function pay(ctx: Ctx): Promise<LiveDemoResult> {
  const version = await ensureReady(ctx);
  const payer = demoPayer();
  const person = demoPerson();
  await topUpIfLow(); // normally a no-op: the last payment already refilled
  const ref = newRef();
  const out = await relayAs(PAYER, payer, NEAR.token, [
    {
      methodName: "ft_transfer_call",
      args: { receiver_id: NEAR.router, amount: LIVE_DEMO.amountUnits.toString(), msg: JSON.stringify({ ref, to: person, version }) },
      gas: gasFor(3),
      deposit: 1n,
    },
  ]);
  const hash = out.transaction_outcome?.id ?? out.transaction?.hash ?? "";
  const verdict = verifyPayment(splitsEvents(out as Parameters<typeof splitsEvents>[0], NEAR.router), { payer, ref, legs: null });
  if (verdict.kind !== "landed" && verdict.kind !== "partly") throw badRequest("LIVE_DEMO_FAILED", "The payment did not go through.");
  const purpose = new Map(SPLIT(person).map((s) => [s.account_id, s.purpose]));
  return {
    hash,
    total: LIVE_DEMO.amountUnits.toString(),
    legs: verdict.legs.map((l) => ({ purpose: purpose.get(l.account_id) ?? l.purpose, amount: l.amount, landed: l.landed })),
  };
}
