/**
 * NEAR JSON-RPC, read only, with plain fetch. Used by the browser (checks before a payment, and
 * reading the result) and by the server (receipt pages). Nothing here can sign.
 */
import { NEAR } from "./config";

type RpcError = { name?: string; cause?: { name?: string }; message?: string; data?: string };

export class NearRpcError extends Error {
  constructor(
    message: string,
    readonly cause_name?: string,
  ) {
    super(message);
  }
}

async function rpc<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(NEAR.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "splits", method, params }),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new NearRpcError(`NEAR RPC answered ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: RpcError };
  if (body.error) throw new NearRpcError(body.error.data ?? body.error.message ?? "NEAR RPC error", body.error.cause?.name);
  return body.result as T;
}

const toBase64 = (s: string) =>
  typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64");

/** Call a view method and parse its JSON result. */
export async function view<T>(contract: string, method: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const r = await rpc<{ result: number[] }>(
    "query",
    { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: toBase64(JSON.stringify(args)) },
    signal,
  );
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export type AccountView = { amount: string; locked: string; storage_usage: number };

/** The account, or null when it does not exist. */
export async function getAccount(id: string, signal?: AbortSignal): Promise<AccountView | null> {
  try {
    return await rpc<AccountView>("query", { request_type: "view_account", finality: "final", account_id: id }, signal);
  } catch (e) {
    if (e instanceof NearRpcError && (e.cause_name === "UNKNOWN_ACCOUNT" || /does not exist/i.test(e.message))) return null;
    throw e;
  }
}

/** NEAR the account can spend: its balance minus what its storage locks (10^19 yocto per byte). */
export function spendable(a: AccountView): bigint {
  const locked = BigInt(a.storage_usage) * 10n ** 19n;
  const free = BigInt(a.amount) - locked;
  return free > 0n ? free : 0n;
}

export async function isRegistered(account: string, signal?: AbortSignal): Promise<boolean> {
  const b = await view<{ total: string } | null>(NEAR.token, "storage_balance_of", { account_id: account }, signal);
  return b !== null;
}

export async function tokenBalance(account: string, signal?: AbortSignal): Promise<bigint> {
  return BigInt(await view<string>(NEAR.token, "ft_balance_of", { account_id: account }, signal));
}

export type SavedSplit = { version: number; shares: { account_id: string; bps: number; purpose: string }[] };

export async function getSplit(account: string, signal?: AbortSignal): Promise<SavedSplit | null> {
  return view<SavedSplit | null>(NEAR.router, "get_split", { account_id: account }, signal);
}

export async function isRefUsed(payer: string, reference: string, signal?: AbortSignal): Promise<boolean> {
  return view<boolean>(NEAR.router, "is_ref_used", { payer, reference }, signal);
}

export type TxOutcome = {
  status: { SuccessValue?: string; Failure?: unknown } | string;
  transaction: { hash: string; signer_id: string; receiver_id: string };
  transaction_outcome: { outcome: { status: unknown } };
  receipts_outcome: { id: string; outcome: { logs: string[]; executor_id: string; status: unknown } }[];
};

/**
 * The transaction once every receipt has executed and is final. NEAR runs the router's
 * cross-contract calls over several blocks, so "final" is the only safe moment to read the result.
 */
export async function finalTx(hash: string, sender: string, signal?: AbortSignal): Promise<TxOutcome> {
  return rpc<TxOutcome>("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" }, signal);
}
