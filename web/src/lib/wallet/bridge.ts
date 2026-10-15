import type { AppKitNetwork } from "@reown/appkit/networks";
import { encodeFunctionData, type Address, type Hex } from "viem";
import type { ContractLeg, VisitorConfig } from "@/lib/api";
import { waitForAccount } from "@/lib/wallet/flow";

/** The SplitsRouter `pay` and USDC `approve` fragments the visitor's wallet signs. */
const routerPayAbi = [
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "legs",
        type: "tuple[]",
        components: [
          { name: "recipient", type: "address" },
          { name: "fixedAmount", type: "uint96" },
          { name: "shareBps", type: "uint16" },
          { name: "purpose", type: "bytes32" },
        ],
      },
      { name: "amount", type: "uint256" },
      { name: "ref", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const approveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** SplitsCrossPay.claim(): a held refund back to the caller (contracts/src/SplitsCrossPay.sol). */
const claimAbi = [{ type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;

const allowanceAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type WalletBridge = {
  connect(): Promise<Address>;
  /** The wallet the last visit left connected, once restored; undefined if there is none. */
  restore(): Promise<Address | undefined>;
  /** The account the wallet has selected right now. */
  account(): Address | undefined;
  ensureArc(): Promise<void>;
  /** Both writes name the reserved account, so a wallet that switched accounts can't sign for it. */
  approve(amount: bigint, from: Address): Promise<Hex>;
  pay(legs: ContractLeg[], amount: bigint, ref: Hex, from: Address): Promise<Hex>;
  waitFor(hash: Hex): Promise<"success" | "reverted">;
  disconnect(): Promise<void>;
  // Cross-chain pay: the same wallet, on the chain where the payer's USDC is.
  ensureChain(chainId: number): Promise<void>;
  allowanceOn(chainId: number, token: Address, owner: Address, spender: Address): Promise<bigint>;
  approveOn(chainId: number, token: Address, spender: Address, amount: bigint, from: Address): Promise<Hex>;
  burnOn(chainId: number, tokenMessenger: Address, data: Hex, from: Address): Promise<Hex>;
  /** Approve and burn in one confirmation where the wallet batches calls atomically (EIP-5792); null otherwise. */
  batchApproveAndBurn(chainId: number, approve: { token: Address; spender: Address; amount: bigint }, burn: { to: Address; data: Hex }, from: Address): Promise<Hex | null>;
  waitOn(chainId: number, hash: Hex): Promise<"success" | "reverted">;
  /** A refund SplitsCrossPay is holding for this wallet, sent back to it on Arc. */
  claimOnArc(crossPay: Address, from: Address): Promise<Hex>;
};

let loaded: Promise<WalletBridge> | null = null;

/**
 * Loads Reown AppKit and wagmi on demand (they are large) and wraps them in the six calls the
 * pay page needs. Called once per page; later calls get the same bridge.
 */
export function loadWalletBridge(config: VisitorConfig, projectId: string): Promise<WalletBridge> {
  loaded ??= build(config, projectId).catch((err) => {
    loaded = null; // a failed download can be retried on the next tap
    throw err;
  });
  return loaded;
}

async function build(config: VisitorConfig, projectId: string): Promise<WalletBridge> {
  const [{ createAppKit }, { defineChain }, { WagmiAdapter }, core] = await Promise.all([
    import("@reown/appkit"),
    import("@reown/appkit/networks"),
    import("@reown/appkit-adapter-wagmi"),
    import("@wagmi/core"),
  ]);

  const arc = defineChain({
    id: config.chainId,
    caipNetworkId: `eip155:${config.chainId}`,
    chainNamespace: "eip155",
    name: config.network === "arc" ? "Arc" : "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: { default: { name: "Arc Explorer", url: config.explorerUrl } },
  });
  // The chains a visitor can pay from, so the same session can switch to where their USDC is.
  const sources = (config.crossPay?.chains ?? []).map((c) =>
    defineChain({
      id: c.chainId,
      caipNetworkId: `eip155:${c.chainId}`,
      chainNamespace: "eip155",
      name: c.name,
      nativeCurrency: { name: c.gas, symbol: c.gas, decimals: 18 },
      rpcUrls: { default: { http: [c.rpcUrl] } },
      blockExplorers: { default: { name: "Explorer", url: c.explorerUrl } },
    }),
  );
  const networks: [AppKitNetwork, ...AppKitNetwork[]] = [arc, ...sources];
  const adapter = new WagmiAdapter({ networks, projectId, ssr: false });
  const wagmi = adapter.wagmiConfig;
  const modal = createAppKit({
    adapters: [adapter],
    networks,
    defaultNetwork: arc,
    projectId,
    metadata: {
      name: "Splits",
      description: "Send once. It lands divided.",
      url: window.location.origin,
      icons: [`${window.location.origin}/icon.png`],
    },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
    themeMode: "light",
    themeVariables: {
      "--w3m-accent": "#0FA39A",
      "--w3m-font-family": "var(--font-manrope), Manrope, sans-serif",
      "--w3m-border-radius-master": "4px",
    },
  });

  // Bring back the session the last visit left, without opening the sheet. Capped, so a wallet
  // that never answers can't hold up a tap on Pay.
  const restored = Promise.race([
    core.reconnect(wagmi).then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((r) => setTimeout(r, 3_000)),
  ]);

  let sheetOpen = false;
  modal.subscribeState((state) => {
    sheetOpen = state.open;
  });

  return {
    connect: () =>
      waitForAccount({
        current: () => core.getAccount(wagmi).address,
        watchAccount: (cb) => core.watchAccount(wagmi, { onChange: (account) => cb(account.address) }),
        watchOpen: (cb) => modal.subscribeState((state) => cb(state.open)),
        isOpen: () => sheetOpen,
        open: async () => {
          await modal.open();
        },
        restored: () => restored,
      }),
    restore: () => restored.then(() => core.getAccount(wagmi).address),
    account: () => core.getAccount(wagmi).address,
    async ensureArc() {
      if (core.getAccount(wagmi).chainId !== config.chainId) await core.switchChain(wagmi, { chainId: config.chainId });
    },
    approve: (amount, from) =>
      core.writeContract(wagmi, {
        account: from,
        address: config.usdc,
        abi: approveAbi,
        functionName: "approve",
        args: [config.router, amount],
        chainId: config.chainId,
      }),
    pay: (legs, amount, ref, from) =>
      core.writeContract(wagmi, {
        account: from,
        address: config.router,
        abi: routerPayAbi,
        functionName: "pay",
        args: [legs.map((l) => ({ ...l, fixedAmount: BigInt(l.fixedAmount) })), amount, ref],
        chainId: config.chainId,
      }),
    async waitFor(hash) {
      const r = await core.waitForTransactionReceipt(wagmi, { hash, chainId: config.chainId });
      return r.status;
    },
    disconnect: () => core.disconnect(wagmi),
    async ensureChain(chainId) {
      if (core.getAccount(wagmi).chainId !== chainId) await core.switchChain(wagmi, { chainId });
    },
    allowanceOn: (chainId, token, owner, spender) =>
      core.readContract(wagmi, { address: token, abi: allowanceAbi, functionName: "allowance", args: [owner, spender], chainId }),
    approveOn: (chainId, token, spender, amount, from) =>
      core.writeContract(wagmi, { account: from, address: token, abi: approveAbi, functionName: "approve", args: [spender, amount], chainId }),
    burnOn: (chainId, tokenMessenger, data, from) => core.sendTransaction(wagmi, { account: from, to: tokenMessenger, data, chainId }),
    async batchApproveAndBurn(chainId, approve, burn, from) {
      try {
        const caps = (await core.getCapabilities(wagmi, { account: from })) as Record<number, { atomic?: { status?: string } }>;
        const atomic = caps[chainId]?.atomic?.status;
        if (atomic !== "supported" && atomic !== "ready") return null;
      } catch {
        return null;
      }
      const { id } = await core.sendCalls(wagmi, {
        account: from,
        chainId,
        forceAtomic: true,
        calls: [
          { to: approve.token, data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [approve.spender, approve.amount] }) },
          { to: burn.to, data: burn.data },
        ],
      });
      // Once the wallet has the bundle, never report "nothing was sent": it may still land.
      const result = await core.waitForCallsStatus(wagmi, { id }).catch(() => {
        throw new Error("bundle-pending");
      });
      const hash = result.receipts?.at(-1)?.transactionHash;
      if (result.status !== "success" || !hash) throw new Error("burn-reverted");
      return hash;
    },
    async waitOn(chainId, hash) {
      const r = await core.waitForTransactionReceipt(wagmi, { hash, chainId });
      return r.status;
    },
    async claimOnArc(crossPay, from) {
      if (core.getAccount(wagmi).chainId !== config.chainId) await core.switchChain(wagmi, { chainId: config.chainId });
      return core.writeContract(wagmi, { account: from, address: crossPay, abi: claimAbi, functionName: "claim", chainId: config.chainId });
    },
  };
}
