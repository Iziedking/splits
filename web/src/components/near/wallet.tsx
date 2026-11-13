"use client";

import * as React from "react";
import { NEAR } from "@/lib/near/config";
import type { WalletTx } from "@/lib/near/payment";
import { setRelayer } from "@/lib/near/rpc";
import { SignInSheet } from "./sign-in-sheet";

/**
 * Two ways in, one interface for every screen:
 * - Email (the main way). The person signs in with a code; Splits made their NEAR account and signs
 *   for it on the server, and its relayer pays the fees (server/near/custody.ts). Custodial.
 * - A NEAR wallet, through NEAR Connect (docs.near.org/tools/near-connect). The app never holds a
 *   key: the wallet shows every transaction and the person approves it there.
 */

type Connector = import("@hot-labs/near-connect").NearConnector;

type WalletState = {
  ready: boolean;
  accountId: string | null;
  /** How the person signed in. "email" accounts pay no fees and never need NEAR. */
  kind: "email" | "wallet" | null;
  /** The email of an email account, for showing the person instead of their account id. */
  email: string | null;
  /** Whether this email account already took its one-off test money. */
  testMoneyTaken: boolean;
  /** Mark the test money as taken after the server sent it. */
  tookTestMoney: () => void;
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
  const [walletAccount, setAccountId] = React.useState<string | null>(null);
  const [emailUser, setEmailUser] = React.useState<{ accountId: string; email: string } | null>(null);
  const [emailOn, setEmailOn] = React.useState(false);
  const [testMoneyTaken, setTestMoneyTaken] = React.useState(false);
  const [sheet, setSheet] = React.useState(false);
  const waiting = React.useRef<{ resolve: () => void } | null>(null);
  const accountId = emailUser?.accountId ?? walletAccount;

  React.useEffect(() => {
    let live = true;
    // Email accounts first: a signed-in email session wins over a remembered wallet.
    fetch("/api/near/me")
      .then(async (r) => {
        if (!r.ok) return;
        const me = (await r.json()) as { accountId: string | null; email?: string; testMoneyTaken?: boolean; relayer?: string };
        if (!live) return;
        setEmailOn(true);
        if (me.relayer) setRelayer(me.relayer);
        if (me.accountId && me.email) {
          setEmailUser({ accountId: me.accountId, email: me.email });
          setTestMoneyTaken(Boolean(me.testMoneyTaken));
        }
      })
      .catch(() => {});
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

  const connectWallet = React.useCallback(async () => {
    const c = await getConnector();
    const w = await c.connect();
    const accounts = await w.getAccounts();
    setAccountId(accounts[0]?.accountId ?? null);
  }, []);

  const closeSheet = React.useCallback(() => {
    setSheet(false);
    waiting.current?.resolve();
    waiting.current = null;
  }, []);

  const value = React.useMemo<WalletState>(
    () => ({
      ready,
      accountId,
      kind: emailUser ? "email" : walletAccount ? "wallet" : null,
      email: emailUser?.email ?? null,
      testMoneyTaken,
      tookTestMoney: () => setTestMoneyTaken(true),
      async signIn() {
        // Without email accounts on this server (local runs without keys), go straight to wallets.
        if (!emailOn) return connectWallet();
        setSheet(true);
        await new Promise<void>((resolve) => (waiting.current = { resolve }));
      },
      async signOut() {
        if (emailUser) {
          await fetch("/api/near/auth/logout", { method: "POST" }).catch(() => {});
          setEmailUser(null);
          setTestMoneyTaken(false);
          return;
        }
        const c = await getConnector();
        await c.disconnect();
        setAccountId(null);
      },
      async send(tx) {
        if (emailUser) {
          const res = await fetch("/api/near/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tx) });
          const data = (await res.json().catch(() => ({}))) as { hash?: string; error?: { message?: string } };
          if (!res.ok || !data.hash) throw new Error(data.error?.message ?? "The payment did not go through. Try again.");
          return data.hash;
        }
        const c = await getConnector();
        const w = await c.wallet();
        const result = await w.signAndSendTransaction({
          network: NEAR.network,
          signerId: walletAccount ?? undefined,
          receiverId: tx.receiverId,
          actions: tx.actions,
        });
        const hash = hashOf(result);
        if (!hash) throw new Error("The wallet sent the transaction but did not return its hash. Check your wallet's history.");
        return hash;
      },
    }),
    [ready, accountId, emailUser, walletAccount, emailOn, testMoneyTaken, connectWallet],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {emailOn && (
        <SignInSheet
          open={sheet}
          onClose={closeSheet}
          onSignedIn={(u) => {
            setEmailUser(u);
            setTestMoneyTaken(false);
            void fetch("/api/near/me")
              .then((r) => r.json())
              .then((me: { testMoneyTaken?: boolean }) => setTestMoneyTaken(Boolean(me.testMoneyTaken)))
              .catch(() => {});
            closeSheet();
          }}
          onWallet={() => {
            closeSheet();
            void connectWallet().catch(() => {});
          }}
        />
      )}
    </WalletContext.Provider>
  );
}

export function useNearWallet(): WalletState {
  const v = React.useContext(WalletContext);
  if (!v) throw new Error("useNearWallet needs NearWalletProvider");
  return v;
}
