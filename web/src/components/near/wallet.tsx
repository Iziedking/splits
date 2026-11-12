"use client";

import * as React from "react";
import { NEAR } from "@/lib/near/config";
import type { WalletTx } from "@/lib/near/payment";

/**
 * Sign-in with a NEAR wallet through NEAR Connect (docs.near.org/tools/near-connect). The app never
 * holds a key: the wallet shows every transaction and the person approves it there.
 */

type Connector = import("@hot-labs/near-connect").NearConnector;

type WalletState = {
  ready: boolean;
  accountId: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Ask the wallet to sign and send one transaction. Returns its hash once the wallet sent it. */
  send: (tx: WalletTx) => Promise<string>;
};

const WalletContext = React.createContext<WalletState | null>(null);

let connectorPromise: Promise<Connector> | null = null;
function getConnector(): Promise<Connector> {
  connectorPromise ??= import("@hot-labs/near-connect").then(
    ({ NearConnector }) =>
      new NearConnector({
        network: NEAR.network,
        features: { signAndSendTransaction: true, [NEAR.network]: true },
        footerBranding: null,
      }),
  );
  return connectorPromise;
}

/** The hash a wallet hands back; wallets differ in where they put it. */
export function hashOf(result: unknown): string | null {
  const r = result as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | null;
  return r?.transaction?.hash ?? r?.transaction_outcome?.id ?? null;
}

export function NearWalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [accountId, setAccountId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    getConnector()
      .then(async (c) => {
        c.on("wallet:signIn", (e) => live && setAccountId(e.accounts[0]?.accountId ?? null));
        c.on("wallet:signOut", () => live && setAccountId(null));
        try {
          const w = await c.wallet();
          const accounts = await w.getAccounts();
          if (live) setAccountId(accounts[0]?.accountId ?? null);
        } catch {
          // Not signed in yet.
        }
      })
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const value = React.useMemo<WalletState>(
    () => ({
      ready,
      accountId,
      async signIn() {
        const c = await getConnector();
        const w = await c.connect();
        const accounts = await w.getAccounts();
        setAccountId(accounts[0]?.accountId ?? null);
      },
      async signOut() {
        const c = await getConnector();
        await c.disconnect();
        setAccountId(null);
      },
      async send(tx) {
        const c = await getConnector();
        const w = await c.wallet();
        const result = await w.signAndSendTransaction({
          network: NEAR.network,
          signerId: accountId ?? undefined,
          receiverId: tx.receiverId,
          actions: tx.actions,
        });
        const hash = hashOf(result);
        if (!hash) throw new Error("The wallet sent the transaction but did not return its hash. Check your wallet's history.");
        return hash;
      },
    }),
    [ready, accountId],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useNearWallet(): WalletState {
  const v = React.useContext(WalletContext);
  if (!v) throw new Error("useNearWallet needs NearWalletProvider");
  return v;
}
