import {
  decodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  hexToNumber,
  keccak256,
  pad,
  slice,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { splitsRouterAbi } from "../chain/abi";
import type { ChainReader, OnchainSplit, RouterReceipt } from "../chain/types";
import { allocate, SplitRuleError, validateLegs } from "../domain/allocation";
import { burnAbi, burnWithHookAbi, decodeHook, FAST, parseBurnMessage, routerRefFor, STANDARD, toBytes32, transmitterAbi, type BurnLog } from "../crosschain/cctp";
import { crossPayAbi } from "../crosschain/crossPayAbi";
import { ARC_DOMAIN, CCTP, chainByCircleCode, SOURCE_CHAINS, type ChainKey, type SourceChain } from "../crosschain/chains";
import type { Iris } from "../crosschain/iris";
import type { SourceReader } from "../crosschain/reader";
import type { EarnProvider } from "../earn/types";
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
  /** SplitsCrossPay: refunds held for payers who couldn't receive them. */
  owed: Map<string, bigint>;
  /** SplitsCrossPay events this call emitted (stamped with the hash when it settles). */
  cross: { ref: string; payer: string; kind: "paid" | "refunded"; feeBack: bigint; amount: bigint; owed: boolean }[];
};

type SourceTx = { chain: ChainKey; from: Address; nonce: number; burns: BurnLog[]; status: "success" | "reverted" | "dropped" | "pending" };

export type PreviewArcOptions = {
  /** How many getTx polls report "pending" before the final state. */
  pendingPolls?: number;
};

export class PreviewArc {
  readonly router = PREVIEW_ROUTER;
  /** SplitsCrossPay in preview: the same rules as contracts/src/SplitsCrossPay.sol. */
  readonly crossPay = getAddress("0x5911750000000000000000000000000000000c05");

  // Visitors' own wallets on the source chains (cross-chain pay).
  private sourceTxs = new Map<string, SourceTx>();
  private sourceNonces = new Map<string, number>();
  private sourceCount = 0;
  private crossEvents: { ref: string; payer: string; kind: "paid" | "refunded"; txHash: Hex; feeBack: bigint; amount: bigint; owed: boolean }[] = [];
  private owed = new Map<string, bigint>();
  private reattested = new Set<string>();
  /** Test hook: every attestation stays "missing" or "pending" while set. */
  irisHold: "missing" | "pending" | null = null;
  /** Test hook: Circle's Fast fee in basis points (default 1). */
  irisFeeBps: number | null = null;
  /** Test hook: Circle's remaining Fast Transfer allowance. */
  fastAllowanceUnits = 10_000_000_000_000n;
  /** Test hook: Iris answers nothing (fees, messages and allowance all throw). */
  irisDown = false;
  /** Test hook: the next relay of a fresh attestation reverts "Message expired" until it is re-attested. */
  expireNextAttestation = false;
  /** Test hook: Circle refuses to re-attest. */
  reattestFails = false;
  /** Test hook: the next N relays revert. */
  relayFailuresLeft = 0;
  /** Test hook: the next N reads of SplitsCrossPay's outcome see nothing yet (events not indexed). */
  crossOutcomeLag = 0;
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
  private sent: { payer: string; ref: string; txHash: Hex; block: bigint }[] = [];
  private externalCount = 0;

  // Other chains, for deposits: each derived wallet keeps its Arc address on that chain.
  /** `since`: like Circle, a derived wallet lists only transfers that arrived after it was derived. */
  private derived = new Map<string, { address: Address; chain: ChainKey; since: number }>();
  private chainBalances = new Map<string, bigint>();
  private chainAllowances = new Map<string, bigint>();
  private chainInbound = new Map<string, { chain: ChainKey; to: string; amount: bigint; seq: number }>();
  private inboundSeq = 0;
  private burns = new Map<string, Hex>();
  private usedNonces = new Set<string>();
  private crossCount = 0;
  /** Receipts of transactions sent from derived wallets on the simulated source chains. */
  private chainReceipts = new Map<string, "success" | "reverted">();

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
    return this.wallets.get(walletId) ?? this.derived.get(walletId)?.address;
  }

  /** Someone sends USDC to `to` on another chain. Returns the transaction hash on that chain. */
  simulateDeposit(chain: ChainKey, to: Address, amount: bigint): Hex {
    const txHash = keccak256(stringToHex(`preview:deposit:${this.crossCount++}`));
    const key = `${chain}:${to.toLowerCase()}`;
    this.chainBalances.set(key, (this.chainBalances.get(key) ?? 0n) + amount);
    this.chainInbound.set(txHash, { chain, to: to.toLowerCase(), amount, seq: this.inboundSeq++ });
    return txHash;
  }

  /** Someone's own USDC on a source chain (a visitor's wallet). */
  fundSource(chain: ChainKey, address: Address, amount: bigint) {
    const key = `${chain}:${address.toLowerCase()}`;
    this.chainBalances.set(key, (this.chainBalances.get(key) ?? 0n) + amount);
  }

  /**
   * A visitor's own wallet on a source chain: USDC approve, or depositForBurnWithHook. Returns the
   * hash; a call that reverts is recorded as reverted, with nothing moved.
   */
  sourceCall(chain: ChainKey, from: Address, contract: Address, callData: Hex): Hex {
    const nonceKey = `${chain}:${from.toLowerCase()}`;
    const nonce = this.sourceNonces.get(nonceKey) ?? 0;
    this.sourceNonces.set(nonceKey, nonce + 1);
    const txHash = keccak256(stringToHex(`preview:source:${this.sourceCount++}`));
    try {
      const burns = this.applySourceCall(SOURCE_CHAINS[chain], from, contract, callData, txHash);
      this.sourceTxs.set(txHash, { chain, from: getAddress(from), nonce, burns, status: "success" });
    } catch (err) {
      if (!(err instanceof Revert)) throw err;
      this.sourceTxs.set(txHash, { chain, from: getAddress(from), nonce, burns: [], status: "reverted" });
    }
    return txHash;
  }

  /** Test hook: a transaction sent at `nonce` that the chain has seen but not mined yet (low fee). */
  pendSourceTx(chain: ChainKey, from: Address, nonce: number): Hex {
    const txHash = keccak256(stringToHex(`preview:pending:${this.sourceCount++}`));
    this.sourceTxs.set(txHash, { chain, from: getAddress(from), nonce, burns: [], status: "pending" });
    return txHash;
  }

  /** Test hook: a transaction sent at `nonce` that never mined, replaced by another at the same nonce. */
  dropSourceTx(chain: ChainKey, from: Address, nonce: number): Hex {
    const txHash = keccak256(stringToHex(`preview:dropped:${this.sourceCount++}`));
    this.sourceTxs.set(txHash, { chain, from: getAddress(from), nonce, burns: [], status: "dropped" });
    const nonceKey = `${chain}:${from.toLowerCase()}`;
    this.sourceNonces.set(nonceKey, Math.max(this.sourceNonces.get(nonceKey) ?? 0, nonce + 1));
    return txHash;
  }

  /** Reads balances and transfers on the simulated source chains. */
  readonly sourceReader: SourceReader = {
    usdcBalance: async (chain, address) => this.chainBalances.get(`${chain.key}:${address.toLowerCase()}`) ?? 0n,
    verifyInbound: async (chain, txHash, to) => {
      const t = this.chainInbound.get(txHash);
      return t && t.chain === chain.key && t.to === to.toLowerCase() ? { ok: true, amount: t.amount } : { ok: false };
    },
    receiptStatus: async (_chain, txHash) => {
      if (this.chainInbound.has(txHash)) return "success";
      const own = this.sourceTxs.get(txHash);
      if (own) return own.status === "dropped" || own.status === "pending" ? null : own.status;
      return this.chainReceipts.get(txHash) ?? null;
    },
    cctpDomain: async (chain) => chain.domain,
    chainId: async (chain) => chain.chainId.testnet,
    burnReceipt: async (chain, txHash) => {
      const tx = this.sourceTxs.get(txHash);
      if (!tx || tx.chain !== chain.key || tx.status === "dropped" || tx.status === "pending") return null;
      if (tx.status === "reverted") return { status: "reverted", from: tx.from, nonce: tx.nonce, burns: [] };
      return { status: tx.status, from: tx.from, nonce: tx.nonce, burns: tx.burns };
    },
    burnsFrom: async (chain, depositor) =>
      [...this.sourceTxs]
        .filter(([, t]) => t.chain === chain.key && t.status === "success" && t.from.toLowerCase() === depositor.toLowerCase())
        .flatMap(([txHash, t]) => t.burns.map((burn) => ({ txHash: txHash as Hex, burn }))),
    pendingNonce: async (chain, address) => this.sourceNonces.get(`${chain.key}:${address.toLowerCase()}`) ?? 0,
    transactionNonce: async (chain, txHash) => {
      const tx = this.sourceTxs.get(txHash);
      return tx && tx.chain === chain.key ? tx.nonce : null;
    },
    blockNumber: async () => BigInt(this.sourceCount + 1),
  };

  /** Attests every simulated burn at once, at 1 bps for Fast and free for Standard. */
  readonly iris: Iris = {
    fees: async () => {
      if (this.irisDown) throw new Error("Iris fees 503");
      return { fastBps: this.irisFeeBps ?? 1, standardBps: 0 };
    },
    fastAllowance: async () => {
      if (this.irisDown) throw new Error("Iris allowance 503");
      return this.fastAllowanceUnits;
    },
    reattest: async (nonce) => {
      if (this.reattestFails) throw new Error("Iris reattest 500");
      this.reattested.add(nonce.toLowerCase());
    },
    message: async (_domain, txHash) => {
      if (this.irisDown) throw new Error("Iris messages 503");
      const message = this.burns.get(txHash);
      if (!message) return { status: "missing" };
      if (this.irisHold === "missing") return { status: "missing" };
      if (this.irisHold === "pending") {
        // A Fast burn that Circle had to take the standard way says why it is waiting.
        const slow = hexToNumber(slice(message, 140, 144)) <= FAST && hexToNumber(slice(message, 144, 148)) > FAST;
        return { status: "pending", delayReason: slow ? "insufficient_fee" : null };
      }
      return { status: "complete", message, attestation: "0x01" };
    },
  };

  /** USDC transfers into an address, newest first, the way a wallet provider lists them. */
  inboundFor(address: Address) {
    return this.inbound.get(address.toLowerCase()) ?? [];
  }

  // ---------------------------------------------------------------- Earn: one simulated vault

  readonly earnVaultAddress = getAddress("0x5911750000000000000000000000000000000e4e");
  private earnAssets = new Map<string, bigint>();
  private earnPrincipal = new Map<string, bigint>();
  private earnCount = 0;
  /** Every vault call, for tests. */
  readonly earnCalls: { kind: "deposit" | "withdraw"; owner: string; amount: bigint }[] = [];
  /** Test hook: a withdrawal returns this many base units less, like a vault rounding shares down. */
  earnShortfall = 0n;
  /**
   * Test hook for the next withdrawal only: it is sent but the wait for it times out. "pending"
   * holds it until earnSettlePending() lands it; "dropped" means it never lands.
   */
  earnStall: "pending" | "dropped" | null = null;
  private earnPending: (() => void) | null = null;

  /** Lands a withdrawal held by earnStall = "pending". */
  earnSettlePending() {
    this.earnPending?.();
    this.earnPending = null;
  }

  /** Interest for tests and demos: grows a position (the vault is credited too). */
  earnAccrue(owner: Address, amount: bigint) {
    const key = owner.toLowerCase();
    this.earnAssets.set(key, (this.earnAssets.get(key) ?? 0n) + amount);
    this.mint(this.earnVaultAddress, amount);
  }

  readonly earnProvider: EarnProvider = {
    vault: async () => ({
      address: this.earnVaultAddress,
      name: "Preview USDC Vault",
      apy: 0.042,
      status: "active",
      circleGuarded: true,
      liquidity: 1_000_000_000_000n,
      asset: "USDC",
    }),
    position: async (owner) => {
      const key = owner.toLowerCase();
      return { assets: this.earnAssets.get(key) ?? 0n, principal: this.earnPrincipal.get(key) ?? 0n };
    },
    deposit: async (owner, amount) => {
      const fx = this.fork();
      this.move(fx, owner, this.earnVaultAddress, amount);
      this.commit(fx);
      const key = owner.toLowerCase();
      this.earnAssets.set(key, (this.earnAssets.get(key) ?? 0n) + amount);
      this.earnPrincipal.set(key, (this.earnPrincipal.get(key) ?? 0n) + amount);
      this.earnCalls.push({ kind: "deposit", owner: key, amount });
      return { txHash: keccak256(stringToHex(`preview:earn:${this.earnCount++}`)) };
    },
    withdraw: async (owner, amount) => {
      const key = owner.toLowerCase();
      const held = this.earnAssets.get(key) ?? 0n;
      if (amount > held) throw new Error(`Withdrawal of ${amount} exceeds the position of ${held}`);
      const land = () => {
        const fx = this.fork();
        this.move(fx, this.earnVaultAddress, owner, amount - this.earnShortfall);
        this.commit(fx);
        this.earnAssets.set(key, (this.earnAssets.get(key) ?? 0n) - amount);
        const principal = this.earnPrincipal.get(key) ?? 0n;
        this.earnPrincipal.set(key, principal > amount ? principal - amount : 0n);
      };
      this.earnCalls.push({ kind: "withdraw", owner: key, amount });
      const stall = this.earnStall;
      this.earnStall = null;
      if (stall) {
        if (stall === "pending") this.earnPending = land;
        throw new Error("Timed out waiting for the withdrawal to confirm");
      }
      land();
      return { txHash: keccak256(stringToHex(`preview:earn:${this.earnCount++}`)) };
    },
  };

  // ---------------------------------------------------------------- adapters

  readonly walletProvider: WalletProvider = {
    createWallet: async ({ refId, idempotencyKey }) => {
      requireUuid(idempotencyKey);
      const existing = this.walletKeys.get(idempotencyKey);
      if (existing) return { providerWalletId: existing, address: this.wallets.get(existing)! };
      const providerWalletId = `preview-wallet-${refId}`;
      const address = this.addressFor(providerWalletId);
      this.wallets.set(providerWalletId, address);
      this.walletKeys.set(idempotencyKey, providerWalletId);
      return { providerWalletId, address };
    },

    execute: async ({ walletId, contract, callData, idempotencyKey }) => {
      const onChain = this.derived.get(walletId);
      if (onChain) return this.submitOnChain(idempotencyKey, onChain, contract, callData);
      return this.submit(idempotencyKey, () => this.applyCall(this.requireWallet(walletId), contract, callData));
    },

    deriveOn: async (walletId, blockchain) => {
      const found = chainByCircleCode(blockchain);
      if (!found) throw new Error(`Preview cannot derive onto ${blockchain}`);
      const providerWalletId = `${walletId}@${blockchain}`;
      const address = this.requireWallet(walletId);
      if (!this.derived.has(providerWalletId)) this.derived.set(providerWalletId, { address, chain: found.chain.key, since: this.inboundSeq });
      return { providerWalletId, address };
    },

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

    listInbound: async (walletId, limit) => {
      const onChain = this.derived.get(walletId);
      if (onChain) {
        return [...this.chainInbound]
          .filter(([, t]) => t.chain === onChain.chain && t.to === onChain.address.toLowerCase() && t.seq >= onChain.since)
          .reverse()
          .slice(0, limit)
          .map(([txHash, t]) => ({ txHash: txHash as Hex, from: zeroAddress, amount: t.amount, at: new Date() }));
      }
      return this.inboundFor(this.requireWallet(walletId)).slice(0, limit);
    },

    walletAddress: async (walletId) => this.derived.get(walletId)?.address ?? this.requireWallet(walletId),
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
    blockNumber: async () => this.block,
    findSplitSent: async (payer, ref, fromBlock) =>
      this.sent.find((s) => s.payer === payer.toLowerCase() && s.ref === ref.toLowerCase() && s.block >= fromBlock)?.txHash ??
      null,
    cctpNonceUsed: async (_transmitter, nonce) => this.usedNonces.has(nonce.toLowerCase()),
    crossPayOutcome: async (contract, ref, payer) => {
      if (contract.toLowerCase() !== this.crossPay.toLowerCase()) return null;
      if (this.crossOutcomeLag > 0) {
        this.crossOutcomeLag--;
        return null;
      }
      const e = this.crossEvents.find((x) => x.ref === ref.toLowerCase() && x.payer === payer.toLowerCase());
      if (!e) return null;
      return e.kind === "paid" ? { kind: "paid", txHash: e.txHash, feeBack: e.feeBack } : { kind: "refunded", txHash: e.txHash, amount: e.amount, owed: e.owed };
    },
    crossPayWiring: async (contract) =>
      contract.toLowerCase() === this.crossPay.toLowerCase()
        ? { usdc: this.usdc, transmitter: CCTP.testnet.messageTransmitter, router: this.router, tokenMessenger: CCTP.testnet.tokenMessenger }
        : null,
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
    requireUuid(idempotencyKey);
    const existing = this.txKeys.get(idempotencyKey);
    if (existing) return { providerTxId: existing };

    const providerTxId = `preview-tx-${this.txs.size + 1}`;
    const txHash = keccak256(stringToHex(`preview:tx:${providerTxId}`));
    this.txKeys.set(idempotencyKey, providerTxId);
    try {
      const receipt = this.settle(run(), txHash);
      this.txs.set(providerTxId, { polls: 0, outcome: { ok: true, receipt } });
    } catch (err) {
      if (!(err instanceof Revert) && !(err instanceof SplitRuleError)) throw err;
      this.revert(txHash);
      this.txs.set(providerTxId, { polls: 0, outcome: { ok: false, error: err.message, txHash } });
    }
    return { providerTxId };
  }

  /** A call from a derived wallet on another chain: USDC approve, or a CCTP burn to Arc. */
  private submitOnChain(idempotencyKey: string, from: { address: Address; chain: ChainKey }, contract: Address, callData: Hex) {
    requireUuid(idempotencyKey);
    const existing = this.txKeys.get(idempotencyKey);
    if (existing) return { providerTxId: existing };
    const providerTxId = `preview-tx-${this.txs.size + 1}`;
    const txHash = keccak256(stringToHex(`preview:chain-tx:${providerTxId}`));
    this.txKeys.set(idempotencyKey, providerTxId);
    try {
      this.applyChainCall(SOURCE_CHAINS[from.chain], from.address, contract, callData, txHash);
      this.chainReceipts.set(txHash, "success");
      const receipt: RouterReceipt = { txHash, status: "success", blockNumber: this.block++, splitCreated: [], splitLegsSet: [], splitSent: [], legPaid: [] };
      this.txs.set(providerTxId, { polls: 0, outcome: { ok: true, receipt } });
    } catch (err) {
      if (!(err instanceof Revert)) throw err;
      this.chainReceipts.set(txHash, "reverted");
      this.txs.set(providerTxId, { polls: 0, outcome: { ok: false, error: err.message, txHash } });
    }
    return { providerTxId };
  }

  private applyChainCall(chain: SourceChain, sender: Address, contract: Address, callData: Hex, txHash: Hex) {
    const usdc = chain.usdc.testnet;
    const own = `${chain.key}:${sender.toLowerCase()}`;
    if (contract.toLowerCase() === usdc.toLowerCase()) {
      const call = decodeFunctionData({ abi: erc20Abi, data: callData });
      if (call.functionName !== "approve") throw new Revert(`Preview USDC does not support ${call.functionName}`);
      this.chainAllowances.set(`${own}:${call.args[0].toLowerCase()}`, call.args[1]);
      return;
    }
    if (contract.toLowerCase() !== CCTP.testnet.tokenMessenger.toLowerCase()) throw new Revert("Unknown contract");
    const call = decodeFunctionData({ abi: burnAbi, data: callData });
    const [amount, destinationDomain, mintRecipient, burnToken, , maxFee, threshold] = call.args;
    const allowanceKey = `${own}:${contract.toLowerCase()}`;
    const allowance = this.chainAllowances.get(allowanceKey) ?? 0n;
    const balance = this.chainBalances.get(own) ?? 0n;
    if (burnToken.toLowerCase() !== usdc.toLowerCase()) throw new Revert("Unsupported burn token");
    if (destinationDomain !== ARC_DOMAIN) throw new Revert("Preview only burns to Arc");
    if (allowance < amount) throw new Revert("ERC20InsufficientAllowance");
    if (balance < amount) throw new Revert("ERC20InsufficientBalance");
    const feeExecuted = threshold <= FAST ? (amount * 100n + 999_999n) / 1_000_000n : 0n;
    if (feeExecuted > maxFee) throw new Revert("Max fee too low");
    this.chainAllowances.set(allowanceKey, allowance - amount);
    this.chainBalances.set(own, balance - amount);
    const nonce = keccak256(stringToHex(`preview:nonce:${this.crossCount++}`));
    const body = encodePacked(
      ["uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256"],
      [1, toBytes32(usdc), mintRecipient, amount, toBytes32(sender), maxFee, feeExecuted, 0n],
    );
    this.burns.set(
      txHash,
      encodePacked(
        ["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32", "bytes"],
        [1, chain.domain, ARC_DOMAIN, nonce, toBytes32(contract), toBytes32(contract), pad("0x00"), threshold, threshold, body],
      ),
    );
  }

  /** A call from a wallet Splits doesn't hold, the way a visitor's own wallet calls Arc. */
  callFrom(sender: Address, contract: Address, callData: Hex): Hex {
    const txHash = keccak256(stringToHex(`preview:external:${this.externalCount++}`));
    try {
      this.settle(this.applyCall(sender, contract, callData), txHash);
    } catch (err) {
      if (!(err instanceof Revert) && !(err instanceof SplitRuleError)) throw err;
      this.revert(txHash);
    }
    return txHash;
  }

  private settle(fx: Effects, txHash: Hex): RouterReceipt {
    this.commit(fx);
    for (const m of fx.moves) {
      const key = m.to.toLowerCase();
      this.inbound.set(key, [{ txHash, from: m.from, amount: m.amount, at: new Date() }, ...(this.inbound.get(key) ?? [])]);
    }
    const receipt: RouterReceipt = { txHash, status: "success", blockNumber: this.block++, ...fx.receipt };
    for (const e of fx.cross) this.crossEvents.push({ ...e, txHash });
    this.receipts.set(txHash, receipt);
    for (const s of receipt.splitSent) {
      this.sent.push({ payer: s.payer.toLowerCase(), ref: s.ref.toLowerCase(), txHash, block: receipt.blockNumber });
    }
    return receipt;
  }

  private revert(txHash: Hex) {
    this.receipts.set(txHash, {
      txHash,
      status: "reverted",
      blockNumber: this.block++,
      splitCreated: [],
      splitLegsSet: [],
      splitSent: [],
      legPaid: [],
    });
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
      owed: new Map(this.owed),
      cross: [],
    };
  }

  /** A copy of `fx` to try a call on; adopted only if the call doesn't revert. */
  private branch(fx: Effects): Effects {
    return {
      ...fx,
      balances: new Map(fx.balances),
      allowances: new Map(fx.allowances),
      splits: new Map([...fx.splits].map(([k, v]) => [k, structuredClone(v)])),
      refs: new Set(fx.refs),
      receipt: structuredClone(fx.receipt),
      moves: [...fx.moves],
      owed: new Map(fx.owed),
      cross: [...fx.cross],
    };
  }

  private commit(fx: Effects) {
    this.balances = fx.balances;
    this.allowances = fx.allowances;
    this.splits = fx.splits;
    this.refs = fx.refs;
    this.nextSplitId = fx.nextSplitId;
    this.owed = fx.owed;
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
    if (contract.toLowerCase() === CCTP.testnet.messageTransmitter.toLowerCase()) {
      const call = decodeFunctionData({ abi: transmitterAbi, data: callData });
      if (call.functionName !== "receiveMessage") throw new Revert(`Preview transmitter does not support ${call.functionName}`);
      this.mintInto(fx, sender, call.args[0]);
      return fx;
    }
    if (contract.toLowerCase() === this.crossPay.toLowerCase()) return this.crossPayCall(fx, sender, callData);
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
        this.payInFx(fx, sender, rawLegs.map((l) => ({ ...l })), amount, ref);
        return fx;
      }
      default:
        throw new Revert(`Preview router does not support ${call.functionName}`);
    }
  }

  /** SplitsRouter.pay, applied to `fx`: all or nothing (a Revert leaves `fx` half-applied; callers branch). */
  private payInFx(fx: Effects, sender: Address, legs: OnchainSplit["legs"], amount: bigint, ref: Hex) {
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
  }

  /** MessageTransmitterV2.receiveMessage as `caller`: domain, nonce and destination caller checked, then minted. */
  private mintInto(fx: Effects, caller: Address, message: Hex) {
    const m = parseBurnMessage(message);
    if (m.destinationDomain !== ARC_DOMAIN) throw new Revert("Invalid destination domain");
    if (this.usedNonces.has(m.nonce.toLowerCase())) throw new Revert("Nonce already used");
    if (m.destinationCaller !== zeroAddress && m.destinationCaller.toLowerCase() !== caller.toLowerCase()) throw new Revert("Invalid caller for message");
    const minted = m.amount - m.feeExecuted;
    const key = m.mintRecipient.toLowerCase();
    fx.balances.set(key, (fx.balances.get(key) ?? 0n) + minted);
    fx.moves.push({ from: zeroAddress, to: m.mintRecipient, amount: minted });
    this.usedNonces.add(m.nonce.toLowerCase());
  }

  /** SplitsCrossPay: relay (mint, then pay or refund) and claim, as contracts/src/SplitsCrossPay.sol. */
  private crossPayCall(fx: Effects, sender: Address, callData: Hex): Effects {
    const call = decodeFunctionData({ abi: crossPayAbi, data: callData });
    if (call.functionName === "claim") {
      const amount = fx.owed.get(sender.toLowerCase()) ?? 0n;
      if (amount === 0n) throw new Revert("NothingOwed");
      fx.owed.set(sender.toLowerCase(), 0n);
      this.move(fx, this.crossPay, sender, amount);
      return fx;
    }
    if (call.functionName !== "relay") throw new Revert(`Preview SplitsCrossPay does not support ${call.functionName}`);
    if (this.relayFailuresLeft > 0) {
      this.relayFailuresLeft--;
      throw new Revert("relay test failure");
    }
    const [message] = call.args;
    if (slice(message, 76, 108).toLowerCase() !== toBytes32(CCTP.testnet.tokenMessenger)) throw new Revert("NotABurn");
    const m = parseBurnMessage(message);
    if (this.expireNextAttestation) {
      if (!this.reattested.has(m.nonce.toLowerCase())) throw new Revert("Message expired");
      this.expireNextAttestation = false;
    }
    const before = fx.balances.get(this.crossPay.toLowerCase()) ?? 0n;
    this.mintInto(fx, this.crossPay, message);
    const minted = (fx.balances.get(this.crossPay.toLowerCase()) ?? 0n) - before;
    const hook = decodeHook(m.hookData);
    const payer = hook && hook.refundTo !== zeroAddress ? hook.refundTo : m.messageSender;
    const ref = hook?.ref ?? pad("0x00");
    const refund = () => {
      const owed = this.sendOrOwe(fx, payer, minted);
      fx.cross.push({ ref: ref.toLowerCase(), payer: payer.toLowerCase(), kind: "refunded", feeBack: 0n, amount: minted, owed });
      return fx;
    };
    if (!hook || minted < hook.payAmount || hook.legs.some((l) => l.recipient.toLowerCase() === this.crossPay.toLowerCase())) return refund();
    const tried = this.branch(fx);
    try {
      tried.allowances.set(allowanceKey(this.crossPay, this.router), hook.payAmount);
      this.payInFx(tried, this.crossPay, hook.legs, hook.payAmount, routerRefFor(m.sourceDomain, payer, hook.ref));
      tried.allowances.set(allowanceKey(this.crossPay, this.router), 0n);
    } catch (err) {
      if (!(err instanceof Revert) && !(err instanceof SplitRuleError)) throw err;
      return refund();
    }
    Object.assign(fx, tried);
    const back = minted - hook.payAmount;
    fx.cross.push({ ref: ref.toLowerCase(), payer: payer.toLowerCase(), kind: "paid", feeBack: back, amount: hook.payAmount, owed: false });
    if (back > 0n) this.sendOrOwe(fx, payer, back);
    return fx;
  }

  /** A transfer from SplitsCrossPay; one the token refuses is held as owed. Returns whether it was held. */
  private sendOrOwe(fx: Effects, to: Address, amount: bigint): boolean {
    if (amount === 0n) return false;
    try {
      this.move(fx, this.crossPay, to, amount);
      return false;
    } catch (err) {
      if (!(err instanceof Revert)) throw err;
      fx.owed.set(to.toLowerCase(), (fx.owed.get(to.toLowerCase()) ?? 0n) + amount);
      return true;
    }
  }

  /** depositForBurnWithHook (or a USDC approve) from a visitor's own wallet on a source chain. */
  private applySourceCall(chain: SourceChain, sender: Address, contract: Address, callData: Hex, txHash: Hex): BurnLog[] {
    const usdc = chain.usdc.testnet;
    const own = `${chain.key}:${sender.toLowerCase()}`;
    if (contract.toLowerCase() === usdc.toLowerCase()) {
      const call = decodeFunctionData({ abi: erc20Abi, data: callData });
      if (call.functionName !== "approve") throw new Revert(`Preview USDC does not support ${call.functionName}`);
      this.chainAllowances.set(`${own}:${call.args[0].toLowerCase()}`, call.args[1]);
      return [];
    }
    if (contract.toLowerCase() !== CCTP.testnet.tokenMessenger.toLowerCase()) throw new Revert("Unknown contract");
    const call = decodeFunctionData({ abi: burnWithHookAbi, data: callData });
    const [amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, threshold, hookData] = call.args;
    const allowanceKey = `${own}:${contract.toLowerCase()}`;
    const allowance = this.chainAllowances.get(allowanceKey) ?? 0n;
    const balance = this.chainBalances.get(own) ?? 0n;
    if (burnToken.toLowerCase() !== usdc.toLowerCase()) throw new Revert("Unsupported burn token");
    if (destinationDomain !== ARC_DOMAIN) throw new Revert("Preview only burns to Arc");
    if (allowance < amount) throw new Revert("ERC20InsufficientAllowance");
    if (balance < amount) throw new Revert("ERC20InsufficientBalance");
    const bps = BigInt(Math.round((this.irisFeeBps ?? 1) * 100));
    let feeExecuted = threshold <= FAST ? (amount * bps + 999_999n) / 1_000_000n : 0n;
    let executed = threshold <= FAST ? FAST : STANDARD;
    // Circle's fee above maxFee: CCTP attests at finality instead, without the Fast fee.
    if (feeExecuted > maxFee) {
      feeExecuted = 0n;
      executed = STANDARD;
    }
    this.chainAllowances.set(allowanceKey, allowance - amount);
    this.chainBalances.set(own, balance - amount);
    const nonce = keccak256(stringToHex(`preview:nonce:${this.crossCount++}`));
    const body = encodePacked(
      ["uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256", "bytes"],
      [1, toBytes32(usdc), mintRecipient, amount, toBytes32(sender), maxFee, feeExecuted, 0n, hookData],
    );
    this.burns.set(
      txHash,
      encodePacked(
        ["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32", "bytes"],
        [1, chain.domain, ARC_DOMAIN, nonce, toBytes32(contract), toBytes32(contract), destinationCaller, threshold, executed, body],
      ),
    );
    const fromBytes32 = (b: Hex) => getAddress(slice(b, 12, 32));
    return [
      {
        burnToken: getAddress(burnToken),
        amount,
        depositor: getAddress(sender),
        mintRecipient: fromBytes32(mintRecipient),
        destinationDomain,
        destinationCaller: fromBytes32(destinationCaller),
        maxFee,
        minFinalityThreshold: threshold,
        hookData,
      },
    ];
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Circle rejects any idempotency key that isn't a UUID ("API parameter invalid"); so does preview. */
function requireUuid(key: string) {
  if (!UUID.test(key)) throw new Error(`API parameter invalid: idempotencyKey must be a UUID, got "${key}"`);
}
