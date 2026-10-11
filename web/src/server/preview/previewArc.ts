import {
  decodeFunctionData,
  erc20Abi,
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { splitsRouterAbi } from "../chain/abi";
import type { ChainReader, OnchainSplit, RouterReceipt } from "../chain/types";
import { allocate, SplitRuleError, validateLegs } from "../domain/allocation";
import type { ProviderTx, WalletProvider } from "../wallets/types";

/**
 * In-memory stand-in for Arc, the SplitsRouter contract and Circle wallets. It applies the same
 * rules as the contract (through domain/allocation) and the same all-or-nothing semantics, so the
 * preview app and the tests exercise real business behaviour without keys, money or network.
 * Nothing here is ever used when SPLITS_MODE=live.
 */

export const PREVIEW_ROUTER = getAddress("0x5911750000000000000000000000000000000001");
export const PREVIEW_USDC = getAddress("0x3600000000000000000000000000000000000000");
export const PREVIEW_TREASURY_WALLET_ID = "preview-treasury";
const PREVIEW_TREASURY_FLOAT = 10_000_000_000n; // 10,000 USDC

class Revert extends Error {}

type SimTx = {
  polls: number;
  outcome: { ok: true; receipt: RouterReceipt } | { ok: false; error: string; txHash: Hex };
};

type Effects = {
  balances: Map<string, bigint>;
  allowances: Map<string, bigint>;
  splits: Map<bigint, OnchainSplit>;
  refs: Set<string>;
  nextSplitId: bigint;
  receipt: Omit<RouterReceipt, "txHash" | "status" | "blockNumber">;
  moves: { from: Address; to: Address; amount: bigint }[];
};

export type PreviewArcOptions = {
  /** How many getTx polls report "pending" before the final state. */
  pendingPolls?: number;
};

export class PreviewArc {
  readonly router = PREVIEW_ROUTER;
  readonly usdc = PREVIEW_USDC;

  private balances = new Map<string, bigint>();
  private allowances = new Map<string, bigint>();
  private splits = new Map<bigint, OnchainSplit>();
  private refs = new Set<string>();
  private nextSplitId = 1n;
  private block = 1n;

  private wallets = new Map<string, Address>();
  private walletKeys = new Map<string, string>();
  private txs = new Map<string, SimTx>();
  private txKeys = new Map<string, string>();
  private receipts = new Map<string, RouterReceipt>();
  private blocked = new Set<string>();
  private inbound = new Map<string, { txHash: Hex; from: Address; amount: bigint; at: Date }[]>();
  private pendingPolls: number;

  constructor(opts: PreviewArcOptions = {}) {
    this.pendingPolls = opts.pendingPolls ?? 1;
    const treasury = this.addressFor(PREVIEW_TREASURY_WALLET_ID);
    this.wallets.set(PREVIEW_TREASURY_WALLET_ID, treasury);
    this.balances.set(treasury.toLowerCase(), PREVIEW_TREASURY_FLOAT);
  }

  // ---------------------------------------------------------------- test and demo controls

  /** Mirrors Arc's runtime blocklist: transfers to or from a blocked address revert. */
  setBlocked(address: Address, blocked: boolean) {
    if (blocked) this.blocked.add(address.toLowerCase());
    else this.blocked.delete(address.toLowerCase());
  }

  mint(address: Address, amount: bigint) {
    const key = address.toLowerCase();
    this.balances.set(key, (this.balances.get(key) ?? 0n) + amount);
  }

  walletAddress(walletId: string): Address | undefined {
    return this.wallets.get(walletId);
  }

  /** USDC transfers into an address, newest first, the way a wallet provider lists them. */
  inboundFor(address: Address) {
    return this.inbound.get(address.toLowerCase()) ?? [];
  }

  // ---------------------------------------------------------------- adapters

  readonly walletProvider: WalletProvider = {
    createWallet: async ({ refId, idempotencyKey }) => {
      const existing = this.walletKeys.get(idempotencyKey);
      if (existing) return { providerWalletId: existing, address: this.wallets.get(existing)! };
      const providerWalletId = `preview-wallet-${refId}`;
      const address = this.addressFor(providerWalletId);
      this.wallets.set(providerWalletId, address);
      this.walletKeys.set(idempotencyKey, providerWalletId);
      return { providerWalletId, address };
    },

    execute: async ({ walletId, contract, callData, idempotencyKey }) =>
      this.submit(idempotencyKey, () => this.applyCall(this.requireWallet(walletId), contract, callData)),

    transferUsdc: async ({ walletId, to, amount, idempotencyKey }) =>
      this.submit(idempotencyKey, () => {
        const fx = this.fork();
        this.move(fx, this.requireWallet(walletId), to, amount);
        return fx;
      }),

    getTx: async (providerTxId): Promise<ProviderTx> => {
      const tx = this.txs.get(providerTxId);
      if (!tx) throw new Error(`Unknown preview transaction ${providerTxId}`);
      if (tx.polls < this.pendingPolls) {
        tx.polls++;
        return { status: "pending", rawState: "SENT" };
      }
      if (tx.outcome.ok) return { status: "complete", rawState: "COMPLETE", txHash: tx.outcome.receipt.txHash };
      return { status: "failed", rawState: "FAILED", txHash: tx.outcome.txHash, error: tx.outcome.error };
    },

    listInbound: async (walletId, limit) => this.inboundFor(this.requireWallet(walletId)).slice(0, limit),

    walletAddress: async (walletId) => this.requireWallet(walletId),
  };

  readonly chainReader: ChainReader = {
    usdcBalance: async (owner) => this.balances.get(owner.toLowerCase()) ?? 0n,
    usdcAllowance: async (owner, spender) => this.allowances.get(allowanceKey(owner, spender)) ?? 0n,
    refUsed: async (payer, ref) => this.refs.has(refKey(payer, ref)),
    // Like the live probe, the simulated sender is given a balance, so only the recipient and the
    // blocklist decide the answer.
    canReceive: async (from, to) => !this.blocked.has(from.toLowerCase()) && !this.blocked.has(to.toLowerCase()),
    getSplit: async (splitId) => {
      const s = this.splits.get(splitId);
      return s ? structuredClone(s) : null;
    },
    receipt: async (txHash) => this.receipts.get(txHash) ?? null,
  };

  // ---------------------------------------------------------------- internals

  private addressFor(seed: string): Address {
    return getAddress(`0x${keccak256(stringToHex(`preview:${seed}`)).slice(-40)}`);
  }

  private requireWallet(walletId: string): Address {
    const address = this.wallets.get(walletId);
    if (!address) throw new Error(`Unknown preview wallet ${walletId}`);
    return address;
  }

  private submit(idempotencyKey: string, run: () => Effects): { providerTxId: string } {
    const existing = this.txKeys.get(idempotencyKey);
    if (existing) return { providerTxId: existing };

    const providerTxId = `preview-tx-${this.txs.size + 1}`;
    const txHash = keccak256(stringToHex(`preview:tx:${providerTxId}`));
    this.txKeys.set(idempotencyKey, providerTxId);
    try {
      const fx = run();
      this.commit(fx);
      for (const m of fx.moves) {
        const key = m.to.toLowerCase();
        this.inbound.set(key, [{ txHash, from: m.from, amount: m.amount, at: new Date() }, ...(this.inbound.get(key) ?? [])]);
      }
      const receipt: RouterReceipt = { txHash, status: "success", blockNumber: this.block++, ...fx.receipt };
      this.receipts.set(txHash, receipt);
      this.txs.set(providerTxId, { polls: 0, outcome: { ok: true, receipt } });
    } catch (err) {
      if (!(err instanceof Revert) && !(err instanceof SplitRuleError)) throw err;
      this.receipts.set(txHash, {
        txHash,
        status: "reverted",
        blockNumber: this.block++,
        splitCreated: [],
        splitLegsSet: [],
        splitSent: [],
        legPaid: [],
      });
      this.txs.set(providerTxId, { polls: 0, outcome: { ok: false, error: err.message, txHash } });
    }
    return { providerTxId };
  }

  private fork(): Effects {
    return {
      balances: new Map(this.balances),
      allowances: new Map(this.allowances),
      splits: new Map([...this.splits].map(([k, v]) => [k, structuredClone(v)])),
      refs: new Set(this.refs),
      nextSplitId: this.nextSplitId,
      receipt: { splitCreated: [], splitLegsSet: [], splitSent: [], legPaid: [] },
      moves: [],
    };
  }

  private commit(fx: Effects) {
    this.balances = fx.balances;
    this.allowances = fx.allowances;
    this.splits = fx.splits;
    this.refs = fx.refs;
    this.nextSplitId = fx.nextSplitId;
  }

  private move(fx: Effects, from: Address, to: Address, amount: bigint) {
    if (this.blocked.has(from.toLowerCase()) || this.blocked.has(to.toLowerCase())) {
      throw new Revert("Blocklisted");
    }
    const balance = fx.balances.get(from.toLowerCase()) ?? 0n;
    if (balance < amount) throw new Revert("ERC20InsufficientBalance");
    fx.balances.set(from.toLowerCase(), balance - amount);
    fx.balances.set(to.toLowerCase(), (fx.balances.get(to.toLowerCase()) ?? 0n) + amount);
    fx.moves.push({ from, to, amount });
  }

  private applyCall(sender: Address, contract: Address, callData: Hex): Effects {
    const fx = this.fork();
    if (contract.toLowerCase() === this.usdc.toLowerCase()) {
      const call = decodeFunctionData({ abi: erc20Abi, data: callData });
      if (call.functionName !== "approve") throw new Revert(`Preview USDC does not support ${call.functionName}`);
      const [spender, amount] = call.args;
      fx.allowances.set(allowanceKey(sender, spender), amount);
      return fx;
    }
    if (contract.toLowerCase() !== this.router.toLowerCase()) throw new Revert("Unknown contract");

    const call = decodeFunctionData({ abi: splitsRouterAbi, data: callData });
    switch (call.functionName) {
      case "createSplit": {
        const legs = call.args[0].map((l) => ({ ...l }));
        validateLegs(legs, [this.router, this.usdc]);
        const splitId = fx.nextSplitId++;
        fx.splits.set(splitId, { owner: sender, version: 1, active: true, legs });
        fx.receipt.splitCreated.push({ splitId, owner: sender });
        fx.receipt.splitLegsSet.push({ splitId, version: 1 });
        return fx;
      }
      case "updateSplit": {
        const [splitId, rawLegs] = call.args;
        const split = this.owned(fx, splitId, sender);
        const legs = rawLegs.map((l) => ({ ...l }));
        validateLegs(legs, [this.router, this.usdc]);
        split.legs = legs;
        split.version += 1;
        fx.receipt.splitLegsSet.push({ splitId, version: split.version });
        return fx;
      }
      case "setActive": {
        const [splitId, active] = call.args;
        this.owned(fx, splitId, sender).active = active;
        return fx;
      }
      case "send": {
        const [splitId, expectedVersion, amount, ref] = call.args;
        const split = fx.splits.get(splitId);
        if (!split) throw new Revert("SplitNotFound");
        if (!split.active) throw new Revert("SplitInactive");
        if (split.version !== expectedVersion) throw new Revert("VersionMismatch");
        if (amount === 0n) throw new Revert("ZeroAmount");
        if (/^0x0+$/.test(ref)) throw new Revert("ZeroRef");
        if (fx.refs.has(refKey(sender, ref))) throw new Revert("RefAlreadyUsed");
        fx.refs.add(refKey(sender, ref));

        const amounts = allocate(split.legs, amount);
        fx.receipt.splitSent.push({ splitId, payer: sender, ref, amount, version: split.version });
        split.legs.forEach((leg, i) => {
          const legAmount = amounts[i]!;
          if (legAmount === 0n) return;
          const key = allowanceKey(sender, this.router);
          const allowance = fx.allowances.get(key) ?? 0n;
          if (allowance < legAmount) throw new Revert("ERC20InsufficientAllowance");
          fx.allowances.set(key, allowance - legAmount);
          this.move(fx, sender, leg.recipient, legAmount);
          fx.receipt.legPaid.push({ splitId, ref, recipient: leg.recipient, amount: legAmount, purpose: leg.purpose });
        });
        return fx;
      }
      case "pay": {
        const [rawLegs, amount, ref] = call.args;
        const legs = rawLegs.map((l) => ({ ...l }));
        validateLegs(legs, [this.router, this.usdc]);
        if (amount === 0n) throw new Revert("ZeroAmount");
        if (/^0x0+$/.test(ref)) throw new Revert("ZeroRef");
        if (fx.refs.has(refKey(sender, ref))) throw new Revert("RefAlreadyUsed");
        fx.refs.add(refKey(sender, ref));
        const amounts = allocate(legs, amount);
        fx.receipt.splitSent.push({ splitId: 0n, payer: sender, ref, amount, version: 0 });
        legs.forEach((leg, i) => {
          const legAmount = amounts[i]!;
          if (legAmount === 0n) return;
          const key = allowanceKey(sender, this.router);
          const allowance = fx.allowances.get(key) ?? 0n;
          if (allowance < legAmount) throw new Revert("ERC20InsufficientAllowance");
          fx.allowances.set(key, allowance - legAmount);
          this.move(fx, sender, leg.recipient, legAmount);
          fx.receipt.legPaid.push({ splitId: 0n, ref, recipient: leg.recipient, amount: legAmount, purpose: leg.purpose });
        });
        return fx;
      }
      default:
        throw new Revert(`Preview router does not support ${call.functionName}`);
    }
  }

  private owned(fx: Effects, splitId: bigint, sender: Address): OnchainSplit {
    const split = fx.splits.get(splitId);
    if (!split) throw new Revert("SplitNotFound");
    if (split.owner.toLowerCase() !== sender.toLowerCase()) throw new Revert("NotSplitOwner");
    return split;
  }
}

function allowanceKey(owner: Address, spender: Address) {
  return `${owner.toLowerCase()}:${spender.toLowerCase()}`;
}

function refKey(payer: Address, ref: Hex) {
  return `${payer.toLowerCase()}:${ref.toLowerCase()}`;
}
