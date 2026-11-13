/**
 * Email accounts on NEAR. A person signs in with an email code; the server then gives them a NEAR
 * account and signs for it. This is custodial: the server can sign for every email account.
 *
 * - Keys. Each person's key is derived from NEAR_KEYS_SECRET and their user id (HMAC-SHA256 as an
 *   ed25519 seed). It is never stored; whoever holds NEAR_KEYS_SECRET can sign for every account.
 * - Accounts. `u-<10 hex>.<NEAR_APP_ACCOUNT>`, created by the app account with 0.03 NEAR for the
 *   account's own storage, with `tax.` and `savings.` pockets under it, all registered to hold USDC
 *   at the app's cost (about 0.034 NEAR per person in all).
 * - Fees. The person signs a meta transaction (NEP-366); the app account relays it and pays the
 *   gas. It relays only what lib/near/relay-rules.ts allows, and registers recipients itself.
 * - Caps. 30 relayed requests per account per day, 2,000 in all per day, 200 new accounts per day.
 * - Test money. 5 USDC from the app account, once per account, at most 100 USDC a day in all.
 */
import { createHash, createHmac, createPrivateKey, createPublicKey } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { NEAR } from "@/lib/near/config";
import type { WalletTx } from "@/lib/near/payment";
import { planRelay } from "@/lib/near/relay-rules";
import type { Ctx } from "../context";
import { rateHits } from "../db/schema";
import { badRequest, tooMany } from "../errors";
import { hitRateLimit, refundRateHit } from "../services/rateLimits";

const DAY = 24 * 60 * 60_000;
const FOREVER = 100 * 365 * DAY;
const TGAS = 10n ** 12n;
const NEW_ACCOUNT_NEAR = 30_000_000_000_000_000_000_000n; // 0.03 NEAR: storage, two pockets and a split deposit
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, one USDC registration

export const CAPS = { relaysPerAccountPerDay: 30, relaysPerDay: 2000, accountsPerDay: 200, testMoneyUnits: 5_000_000n, testMoneyPerDay: 20 } as const;

/** Email accounts work only where the app account and the key secret are set (prod.env). */
export function custodyEnabled(): boolean {
  return Boolean(process.env.NEAR_APP_ACCOUNT && process.env.NEAR_APP_KEY && /^[0-9a-f]{64}$/i.test(process.env.NEAR_KEYS_SECRET ?? ""));
}

export const appAccountId = () => process.env.NEAR_APP_ACCOUNT ?? "";

// ------------------------------------------------------------------ keys

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/** The ed25519 secret key for a 32-byte seed, as NEAR writes it: "ed25519:" + base58(seed ‖ public key). */
export function secretKeyFromSeed(seed: Buffer): string {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
  const pub = createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  return `ed25519:${base58(Buffer.concat([seed, pub]))}`;
}

export function userKeyPair(userId: string, secret = process.env.NEAR_KEYS_SECRET ?? ""): KeyPair {
  const seed = createHmac("sha256", Buffer.from(secret, "hex")).update(`splits-near-user:${userId}`).digest();
  return KeyPair.fromString(secretKeyFromSeed(seed) as `ed25519:${string}`);
}

export function userAccountId(userId: string, app = appAccountId()): string {
  return `u-${createHash("sha256").update(userId).digest("hex").slice(0, 10)}.${app}`;
}

// ------------------------------------------------------------------ chain

let provider: JsonRpcProvider | null = null;
const rpc = () => (provider ??= new JsonRpcProvider({ url: NEAR.rpc }));

let app: Account | null = null;
function appAccount(): Account {
  app ??= new Account(appAccountId(), rpc(), new KeyPairSigner(KeyPair.fromString(process.env.NEAR_APP_KEY as `ed25519:${string}`)));
  return app;
}

async function rpcQuery<T>(params: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(NEAR.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "custody", method: "query", params: { finality: "final", ...params } }),
  });
  const body = (await res.json()) as { result?: T & { result?: number[] }; error?: unknown };
  return body.error ? null : (body.result ?? null);
}

async function exists(account: string): Promise<boolean> {
  return (await rpcQuery({ request_type: "view_account", account_id: account })) !== null;
}

async function viewCall<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T | null> {
  const r = await rpcQuery<{ result: number[] }>({ request_type: "call_function", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return r ? (JSON.parse(Buffer.from(r.result).toString() || "null") as T) : null;
}

const registered = async (account: string) => (await viewCall(NEAR.token, "storage_balance_of", { account_id: account })) !== null;

const hashOf = (out: { transaction_outcome?: { id?: string }; transaction?: { hash?: string } }) => out.transaction_outcome?.id ?? out.transaction?.hash ?? "";

/** Registers accounts for USDC at the app's cost, skipping any already registered. */
async function registerAll(accounts: string[]) {
  const todo: string[] = [];
  for (const a of [...new Set(accounts)].slice(0, 10)) if (!(await registered(a))) todo.push(a);
  if (todo.length === 0) return;
  await appAccount().signAndSendTransaction({
    receiverId: NEAR.token,
    actions: todo.map((account_id) => actions.functionCall("storage_deposit", { account_id, registration_only: true }, 10n * TGAS, STORAGE_DEPOSIT)),
    waitUntil: "FINAL",
  });
}

// ------------------------------------------------------------------ what the routes call

/** The person's NEAR account, created and registered for USDC the first time they sign in. */
export async function ensureNearAccount(ctx: Ctx, userId: string): Promise<string> {
  const account = userAccountId(userId);
  if (!(await exists(account))) {
    if (!(await hitRateLimit(ctx, "near:accounts:day", CAPS.accountsPerDay, DAY))) throw tooMany("NEAR_ACCOUNTS_CAP", "Too many new accounts today. Try again tomorrow.");
    const key = userKeyPair(userId).getPublicKey();
    try {
      await appAccount().signAndSendTransaction({
        receiverId: account,
        actions: [actions.createAccount(), actions.transfer(NEW_ACCOUNT_NEAR), actions.addFullAccessKey(key)],
        waitUntil: "FINAL",
      });
    } catch (e) {
      // Two sign-ins at once: the other one made it. Anything else is a real failure.
      if (!(await exists(account))) throw e;
    }
  }
  await ensurePockets(userId, account);
  await registerAll([account, ...POCKETS.map((p) => `${p}.${account}`)]);
  return account;
}

/** Every email account gets a tax and a savings pocket, so "auto-split my income" works from day one. */
export const POCKETS = ["tax", "savings"] as const;
const POCKET_NEAR = 3_000_000_000_000_000_000_000n; // 0.003 NEAR, the pocket's own storage

async function ensurePockets(userId: string, account: string) {
  const owner = new Account(account, rpc(), new KeyPairSigner(userKeyPair(userId)));
  const key = userKeyPair(userId).getPublicKey();
  for (const p of POCKETS) {
    const pocket = `${p}.${account}`;
    if (await exists(pocket)) continue;
    try {
      await owner.signAndSendTransaction({ receiverId: pocket, actions: [actions.createAccount(), actions.transfer(POCKET_NEAR), actions.addFullAccessKey(key)], waitUntil: "FINAL" });
    } catch (e) {
      if (!(await exists(pocket))) throw e;
    }
  }
}

/** Signs `tx` as the person and relays it, the app paying the gas. Returns the transaction hash. */
export async function relayFor(ctx: Ctx, userId: string, tx: WalletTx): Promise<string> {
  const plan = planRelay(tx, { token: NEAR.token, router: NEAR.router, daoFactory: NEAR.daoFactory });
  if ("error" in plan) throw badRequest("NEAR_RELAY_REFUSED", plan.error);
  const account = userAccountId(userId);
  if (!(await hitRateLimit(ctx, `near:relay:${account}`, CAPS.relaysPerAccountPerDay, DAY))) throw tooMany("NEAR_RELAY_CAP", "You have reached today's limit of payments. Try again tomorrow.");
  if (!(await hitRateLimit(ctx, "near:relay:all", CAPS.relaysPerDay, DAY))) throw tooMany("NEAR_RELAY_CAP", "Splits has reached today's limit. Try again tomorrow.");
  await registerAll(plan.register);
  if (plan.calls.length === 0) return "";
  const user = new Account(account, rpc(), new KeyPairSigner(userKeyPair(userId)));
  const { signedDelegate } = await user.createSignedMetaTransaction({
    receiverId: tx.receiverId,
    actions: plan.calls.map((c) => actions.functionCall(c.methodName, c.args, c.gas, c.deposit)),
  });
  return hashOf(await appAccount().relayMetaTransaction(signedDelegate));
}

const testMoneyKey = (account: string) => `near:testmoney:${account}`;

/** Whether this account already took its test money. */
export async function hadTestMoney(ctx: Ctx, userId: string): Promise<boolean> {
  const rows = await ctx.db.select({ count: rateHits.count }).from(rateHits).where(and(eq(rateHits.key, testMoneyKey(userAccountId(userId))))).limit(1);
  return (rows[0]?.count ?? 0) > 0;
}

/** Sends 5 test USDC from the app account, once per account. Returns the transaction hash. */
export async function sendTestMoney(ctx: Ctx, userId: string): Promise<string> {
  const account = userAccountId(userId);
  if (!(await hitRateLimit(ctx, testMoneyKey(account), 1, FOREVER))) throw badRequest("TEST_MONEY_TAKEN", "You already added your test money.");
  try {
    if (!(await hitRateLimit(ctx, "near:testmoney:day", CAPS.testMoneyPerDay, DAY))) {
      await refundRateHit(ctx, "near:testmoney:day", DAY);
      throw tooMany("TEST_MONEY_CAP", "Test money has run out for today. Try again tomorrow.");
    }
    const left = BigInt((await viewCall<string>(NEAR.token, "ft_balance_of", { account_id: appAccountId() })) ?? "0");
    if (left < CAPS.testMoneyUnits) throw tooMany("TEST_MONEY_EMPTY", "Test money has run out for now. Try again later.");
    await registerAll([account]);
    const out = await appAccount().signAndSendTransaction({
      receiverId: NEAR.token,
      actions: [actions.functionCall("ft_transfer", { receiver_id: account, amount: CAPS.testMoneyUnits.toString(), memo: "Splits test money (no value)" }, 30n * TGAS, 1n)],
      waitUntil: "FINAL",
    });
    return hashOf(out);
  } catch (e) {
    // Nothing was sent, so the account keeps its one go.
    await refundRateHit(ctx, testMoneyKey(account), FOREVER);
    throw e;
  }
}
