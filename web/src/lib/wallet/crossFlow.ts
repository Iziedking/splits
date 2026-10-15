/** Before the burn, nothing has moved; every message says so plainly. Tests pin these strings. */
export const CROSS_WALLET_TEXT = {
  short: (have: string, chain: string, need: string) => `You have $${have} USDC on ${chain}. This payment needs $${need} with fees. Add USDC or pick another chain.`,
  noGas: (gas: string, chain: string) => `You need a little ${gas} on ${chain} for the network fee (about $0.01).`,
  switchChain: (chain: string) => `Switch your wallet to ${chain} to continue.`,
  cancelled: () => "You cancelled in your wallet. Nothing was sent.",
  approveReverted: (chain: string) => `The approval didn't go through on ${chain}. Nothing was sent. Only the network fee was spent.`,
  burnReverted: (chain: string) => `The payment didn't leave ${chain}. Your USDC is still in your wallet. Only the network fee was spent.`,
  unreadable: (chain: string) => `We couldn't read your balance on ${chain}. Try again, or pick another chain.`,
  generic: () => "Your wallet couldn't finish this step. Nothing was sent. Try again.",
  bundlePending: (chain: string) =>
    `Your wallet is still sending this payment on ${chain}. Don't pay again: this page shows it as soon as it's seen.`,
  sentWaiting: (chain: string) =>
    `You sent this payment from your wallet. It shows here as soon as it's seen on ${chain}, so there's no need to pay again.`,
} as const;

/** What went wrong in the wallet before the burn: nothing has moved, and the message says so. */
export function crossWalletError(err: unknown, chainName: string): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text === "bundle-pending") return CROSS_WALLET_TEXT.bundlePending(chainName);
  if (/rejected|denied|cancel/i.test(text)) return CROSS_WALLET_TEXT.cancelled();
  if (text === "approve-reverted") return CROSS_WALLET_TEXT.approveReverted(chainName);
  if (text === "burn-reverted") return CROSS_WALLET_TEXT.burnReverted(chainName);
  if (/chain|network|switch/i.test(text)) return CROSS_WALLET_TEXT.switchChain(chainName);
  return CROSS_WALLET_TEXT.generic();
}

type KeyStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const sentKey = (token: string) => `splits:burn-sent:${token}`;

/** Remembers on this device that the wallet sent this link's burn, so Pay isn't offered again. */
export function markBurnSent(storage: KeyStore | null, token: string) {
  try {
    storage?.setItem(sentKey(token), "1");
  } catch {
    // Private mode or storage off: the server's own state still hides Pay once the burn is reported.
  }
}

export function burnSent(storage: KeyStore | null, token: string): boolean {
  try {
    return storage?.getItem(sentKey(token)) === "1";
  } catch {
    return false;
  }
}
