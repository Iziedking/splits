import type { Address, Hex } from "viem";
import type { ContractLeg, VisitorConfig } from "@/lib/api";

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

export type WalletBridge = {
  connect(): Promise<Address>;
  /** The account the wallet has selected right now. */
  account(): Address | undefined;
  ensureArc(): Promise<void>;
  /** Both writes name the reserved account, so a wallet that switched accounts can't sign for it. */
  approve(amount: bigint, from: Address): Promise<Hex>;
  pay(legs: ContractLeg[], amount: bigint, ref: Hex, from: Address): Promise<Hex>;
  waitFor(hash: Hex): Promise<"success" | "reverted">;
  disconnect(): Promise<void>;
};

let loaded: Promise<WalletBridge> | null = null;

/**
 * Loads Reown AppKit and wagmi on demand (they are large) and wraps them in the six calls the
 * pay page needs. Called once per page; later calls get the same bridge.
 */
export function loadWalletBridge(config: VisitorConfig, projectId: string): Promise<WalletBridge> {
  loaded ??= build(config, projectId);
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
  const adapter = new WagmiAdapter({ networks: [arc], projectId, ssr: false });
  const wagmi = adapter.wagmiConfig;
  const modal = createAppKit({
    adapters: [adapter],
    networks: [arc],
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

  return {
    async connect() {
      const now = core.getAccount(wagmi);
      if (now.address) return now.address;
      await modal.open();
      return new Promise<Address>((resolve, reject) => {
        const stopAccount = core.watchAccount(wagmi, {
          onChange(account) {
            if (account.address) {
              stopAccount();
              stopModal();
              resolve(account.address);
            }
          },
        });
        const stopModal = modal.subscribeState((state) => {
          if (!state.open && !core.getAccount(wagmi).address) {
            stopAccount();
            stopModal();
            reject(new Error("closed"));
          }
        });
      });
    },
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
  };
}
