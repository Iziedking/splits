/**
 * What the app's relayer will send for an email account, checked before it signs anything. The
 * relayer pays the gas, so it only carries the few calls Splits itself makes, with small deposits:
 *
 * - USDC `ft_transfer_call` to the splits router (a payment), with the 1 yoctoNEAR the token asks for;
 * - USDC `storage_deposit` for a recipient, which the relayer pays itself, so it is taken out here;
 * - the router's `set_split`, with at most 0.02 NEAR for its storage;
 * - a vote on a group (`act_proposal` on a Sputnik DAO), with no deposit.
 *
 * Everything else is refused: no transfers of NEAR, no calls to other contracts, no keys.
 */
import type { WalletTx } from "./payment";

export const MAX_INNER_GAS = 280n * 10n ** 12n;
export const MAX_SPLIT_DEPOSIT = 20_000_000_000_000_000_000_000n; // 0.02 NEAR

export type RelayCall = { receiverId: string; methodName: string; args: Record<string, unknown>; gas: bigint; deposit: bigint };
export type RelayPlan = { calls: RelayCall[]; register: string[] };

export type RelayContext = { token: string; router: string; daoFactory: string };

/** The calls to relay and the accounts to register for USDC first, or the reason it is refused. */
export function planRelay(tx: WalletTx, c: RelayContext): RelayPlan | { error: string } {
  if (!tx || !Array.isArray(tx.actions) || tx.actions.length === 0 || tx.actions.length > 12) return { error: "Nothing to send." };
  const calls: RelayCall[] = [];
  const register: string[] = [];
  const isDao = tx.receiverId.endsWith(`.${c.daoFactory}`);
  for (const a of tx.actions) {
    if (a?.type !== "FunctionCall" || !a.params) return { error: "Only app calls can be sent for you." };
    const { methodName, args } = a.params;
    let gas: bigint;
    let deposit: bigint;
    try {
      gas = BigInt(a.params.gas);
      deposit = BigInt(a.params.deposit);
    } catch {
      return { error: "That request is not well formed." };
    }
    if (gas <= 0n || deposit < 0n) return { error: "That request is not well formed." };
    if (tx.receiverId === c.token && methodName === "storage_deposit") {
      const who = typeof args?.account_id === "string" ? args.account_id : "";
      if (!who) return { error: "That request is not well formed." };
      register.push(who);
      continue;
    }
    if (tx.receiverId === c.token && methodName === "ft_transfer_call") {
      if (args?.receiver_id !== c.router) return { error: "Payments can only go through Splits." };
      if (deposit !== 1n) return { error: "That request is not well formed." };
    } else if (tx.receiverId === c.router && methodName === "set_split") {
      if (deposit > MAX_SPLIT_DEPOSIT) return { error: "That split asks for too large a deposit." };
    } else if (isDao && methodName === "act_proposal") {
      if (deposit !== 0n) return { error: "A vote does not carry money." };
    } else {
      return { error: "That action needs a NEAR wallet." };
    }
    calls.push({ receiverId: tx.receiverId, methodName, args: args ?? {}, gas: gas > MAX_INNER_GAS ? MAX_INNER_GAS : gas, deposit });
  }
  if (calls.length === 0) return { calls, register };
  if (calls.reduce((a, x) => a + x.gas, 0n) > MAX_INNER_GAS) return { error: "That request is too large to send in one go." };
  return { calls, register };
}
