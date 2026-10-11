/**
 * The wallet page's logic, kept free of AppKit and React so it can be tested: amounts, error copy,
 * waiting for a connection, and how often a payment link polls.
 */

type Address = `0x${string}`;

/** "12.5" -> 12_500_000n, exactly. */
export function toUnits(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

/** 2_030_000n -> "2.03" (whole cents; the router only moves cents). */
export function unitsToUsd(units: bigint): string {
  return `${units / 1_000_000n}.${((units % 1_000_000n) / 10_000n).toString().padStart(2, "0")}`;
}

export type NetworkInfo = { network: "arc" | "arc-testnet"; chainId: number; rpcUrl: string; explorerUrl: string };

/** What went wrong in the wallet, said so the person knows what to do and that nothing moved. */
export function walletError(err: unknown, net: NetworkInfo): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text.startsWith("wrong-account:")) {
    const want = text.slice("wrong-account:".length);
    return `Switch your wallet back to ${want.slice(0, 6)}…${want.slice(-4)}, the account this payment was set up for. Nothing moved.`;
  }
  if (/rejected|denied/i.test(text)) return "You declined in your wallet. Nothing moved. Try again when you're ready.";
  if (/chain|network/i.test(text)) {
    const name = net.network === "arc" ? "Arc" : "Arc Testnet";
    return (
      `Your wallet didn't switch to ${name}. Add it in your wallet's network settings: name ${name}, ` +
      `chain ID ${net.chainId}, RPC ${net.rpcUrl}, currency USDC, explorer ${net.explorerUrl}. Then try again.`
    );
  }
  if (text === "reverted") return "Arc rejected the approval. Nothing moved. Try again.";
  return "Your wallet couldn't finish this step. Nothing moved. Try again.";
}

export type ConnectDeps = {
  current(): Address | undefined;
  watchAccount(cb: (account: Address | undefined) => void): () => void;
  watchOpen(cb: (open: boolean) => void): () => void;
  isOpen(): boolean;
  open(): Promise<void>;
};

/**
 * Opens the wallet sheet and resolves with the connected account, or rejects "closed" if the
 * person closes it first. Listeners go on before the sheet opens, and the state is checked once it
 * has, so a close at any moment is seen; every listener is removed when it settles.
 */
export function waitForAccount(deps: ConnectDeps): Promise<Address> {
  const now = deps.current();
  if (now) return Promise.resolve(now);
  return new Promise<Address>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      stopAccount();
      stopOpen();
      fn();
    };
    const stopAccount = deps.watchAccount((account) => {
      if (account) finish(() => resolve(account));
    });
    const stopOpen = deps.watchOpen((open) => {
      if (!open && !deps.current()) finish(() => reject(new Error("closed")));
    });
    deps.open().then(
      () => {
        const account = deps.current();
        if (account) finish(() => resolve(account));
        else if (!deps.isOpen()) finish(() => reject(new Error("closed")));
      },
      (err) => finish(() => reject(err)),
    );
  });
}

const LATE_WINDOW_MS = 24 * 60 * 60_000;

/**
 * How long until the payment link asks again, or null to stop. A cancelled reservation is still
 * watched for a day, more slowly, because a payment can land after its reservation ended.
 */
export function nextPoll(status: string, createdAt: string, now = new Date()): number | null {
  if (status === "settled" || status === "failed") return null;
  if (status === "cancelled") return now.getTime() - new Date(createdAt).getTime() < LATE_WINDOW_MS ? 5000 : null;
  return 1200;
}
