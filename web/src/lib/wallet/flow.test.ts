import { describe, expect, it } from "vitest";
import { nextPoll, toUnits, unitsToUsd, waitForAccount, walletError, type ConnectDeps } from "./flow";

const testnet = {
  network: "arc-testnet" as const,
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.io",
  explorerUrl: "https://explorer.testnet.arc.io",
};

describe("amounts on the wallet page", () => {
  it("converts USDC strings to base units and back exactly", () => {
    expect(toUnits("2.03")).toBe(2_030_000n);
    expect(toUnits("12.5")).toBe(12_500_000n);
    expect(toUnits("7")).toBe(7_000_000n);
    expect(unitsToUsd(2_030_000n)).toBe("2.03");
    expect(unitsToUsd(500_000n)).toBe("0.50");
  });
});

describe("wallet errors", () => {
  it("names the reserved account when the wallet switched", () => {
    expect(walletError(new Error("wrong-account:0x00000000000000000000000000000000000000e1"), testnet)).toBe(
      "Switch your wallet back to 0x0000…00e1, the account this payment was set up for. Nothing moved.",
    );
  });

  it("says a reverted approval paid nobody and cost only the network fee", () => {
    expect(walletError(new Error("reverted"), testnet)).toBe(
      "Arc reverted the approval, so nothing was paid. Only Arc's network fee for the attempt left your wallet. Try again.",
    );
  });

  it("gives the exact network details when the wallet won't switch to Arc", () => {
    const text = walletError(new Error("Chain not configured"), testnet);
    expect(text).toContain("Arc Testnet");
    expect(text).toContain("5042002");
    expect(text).toContain("https://rpc.testnet.arc.io");
    expect(text).toContain("https://explorer.testnet.arc.io");
  });

  it("says nothing moved when the person declined", () => {
    expect(walletError(new Error("User rejected the request."), testnet)).toBe(
      "You declined in your wallet. Nothing moved. Try again when you're ready.",
    );
  });
});

/** A fake wallet sheet: tests drive account changes and sheet closes by hand. */
function fakeSheet(opts: { account?: `0x${string}`; closesDuringOpen?: boolean; savedSession?: `0x${string}` } = {}) {
  let account = opts.account;
  let open = false;
  let opens = 0;
  const accountListeners = new Set<(a: `0x${string}` | undefined) => void>();
  const openListeners = new Set<(open: boolean) => void>();
  const deps: ConnectDeps = {
    current: () => account,
    watchAccount: (cb) => (accountListeners.add(cb), () => accountListeners.delete(cb)),
    watchOpen: (cb) => (openListeners.add(cb), () => openListeners.delete(cb)),
    isOpen: () => open,
    // The wallet session the last visit left behind comes back a moment after the bridge loads.
    restored: async () => {
      await Promise.resolve();
      if (opts.savedSession) account = opts.savedSession;
    },
    open: async () => {
      opens++;
      open = true;
      openListeners.forEach((cb) => cb(true));
      if (opts.closesDuringOpen) {
        open = false;
        openListeners.forEach((cb) => cb(false));
      }
    },
  };
  return {
    deps,
    connect(a: `0x${string}`) {
      account = a;
      accountListeners.forEach((cb) => cb(a));
    },
    close() {
      open = false;
      openListeners.forEach((cb) => cb(false));
    },
    /** The wallet finished reconnecting by itself: the account is there, with no change event. */
    reconnectQuietly(a: `0x${string}`) {
      account = a;
    },
    listeners: () => accountListeners.size + openListeners.size,
    opens: () => opens,
  };
}

describe("connecting a wallet", () => {
  const addr = "0x00000000000000000000000000000000000000e1" as const;

  it("uses the wallet the last visit left connected, without opening the sheet", async () => {
    const sheet = fakeSheet({ savedSession: addr });
    await expect(waitForAccount(sheet.deps)).resolves.toBe(addr);
    expect(sheet.opens()).toBe(0);
  });

  it("returns straight away when a wallet is already connected", async () => {
    await expect(waitForAccount(fakeSheet({ account: addr }).deps)).resolves.toBe(addr);
  });

  it("resolves when the person connects, and stops listening", async () => {
    const sheet = fakeSheet();
    const result = waitForAccount(sheet.deps);
    await new Promise((r) => setTimeout(r, 0)); // the sheet opens after the saved session is checked
    sheet.connect(addr);
    await expect(result).resolves.toBe(addr);
    expect(sheet.listeners()).toBe(0);
  });

  it("rejects when the sheet is closed without connecting", async () => {
    const sheet = fakeSheet();
    const result = waitForAccount(sheet.deps);
    await new Promise((r) => setTimeout(r, 0)); // the sheet opens after the saved session is checked
    sheet.close();
    await expect(result).rejects.toThrow("closed");
    expect(sheet.listeners()).toBe(0);
  });

  it("uses a wallet that reconnected while the sheet was open, once the sheet closes", async () => {
    // Back on the page, the wallet reconnects a moment after load; a tap in that moment opens the
    // sheet, the wallet reappears without a change event, and the person closes the sheet.
    const sheet = fakeSheet();
    const result = waitForAccount(sheet.deps);
    await new Promise((r) => setTimeout(r, 0)); // the sheet opens after the saved session is checked
    sheet.reconnectQuietly(addr);
    sheet.close();
    await expect(result).resolves.toBe(addr);
    expect(sheet.listeners()).toBe(0);
  });

  it("doesn't hang when the sheet closes while it is still opening", async () => {
    await expect(waitForAccount(fakeSheet({ closesDuringOpen: true }).deps)).rejects.toThrow("closed");
  });
});

describe("polling a payment link", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  it("polls quickly while the payment is moving", () => {
    expect(nextPoll("awaiting_wallet", ago(1), now)).toBe(1200);
    expect(nextPoll("verifying", ago(1), now)).toBe(1200);
  });

  it("keeps watching a cancelled reservation for a day, because a payment can land late", () => {
    expect(nextPoll("cancelled", ago(60), now)).toBe(5000);
    expect(nextPoll("cancelled", ago(25 * 60), now)).toBeNull();
  });

  it("stops once the payment is settled or failed", () => {
    expect(nextPoll("settled", ago(1), now)).toBeNull();
    expect(nextPoll("failed", ago(1), now)).toBeNull();
  });
});
