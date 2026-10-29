import type { actionView, earnMoveView, meView, receiptView, splitView, transferView, userView, visitorPaymentView, walletView } from "@/server/views";
import type { EarnStatus } from "@/server/services/earn";

/** Response shapes, taken from the server's own view functions so the two can't drift apart. */
export type UserView = ReturnType<typeof userView>;
export type WalletView = ReturnType<typeof walletView>;
export type SplitView = ReturnType<typeof splitView>;
export type TransferView = ReturnType<typeof transferView>;
export type ActionView = ReturnType<typeof actionView>;
export type ReceiptView = ReturnType<typeof receiptView>;
export type VisitorPaymentView = ReturnType<typeof visitorPaymentView>;
export type EarnMoveView = ReturnType<typeof earnMoveView>;
export type { EarnStatus };
/** What a visitor's browser needs to pay on Arc (GET /api/visitor/config). */
export type VisitorConfig = {
  live: boolean;
  network: "arc" | "arc-testnet";
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  router: `0x${string}`;
  usdc: `0x${string}`;
  limits: { perPayment: string; daily: string };
  crossPay: { address: `0x${string}`; chains: CrossChainOption[] } | null;
};
/** A chain a visitor can pay from (cross-chain pay). */
export type CrossChainOption = {
  key: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  usdc: `0x${string}`;
  tokenMessenger: `0x${string}`;
  explorerUrl: string;
  gas: string;
  fast: boolean;
};
/** The full cost of paying from another chain, as decimal USDC strings. */
export type CrossCost = { amount: string; fee: string; circleMax: string; total: string; fast: boolean };
/** The burn the visitor's wallet sends on the source chain. */
export type CrossCall = { chainId: number; usdc: `0x${string}`; tokenMessenger: `0x${string}`; burnAmount: string; data: `0x${string}` };
/** One router leg as the server hands it to the visitor's wallet. */
export type ContractLeg = { recipient: `0x${string}`; fixedAmount: string; shareBps: 0; purpose: `0x${string}` };
import type { ReceivedItem } from "@/server/services/activity";
export type { ReceivedItem };
export type { CheckLine, PayoutCheck } from "@/server/services/payouts";
export type ActivityView = { sent: TransferView[]; received: ReceivedItem[]; receivedError: string | null };
/** GET /api/me. `demoCard` is true only where the test card is switched on (never live mainnet). */
export type Me = ReturnType<typeof meView>;
export type { ComposerFill } from "@/server/agent/draft";
import type { depositView } from "@/server/services/depositView";
import type { listNotifications } from "@/server/services/notifications";
/** The Receive sheet (GET/POST /api/deposits). */
export type DepositView = Awaited<ReturnType<typeof depositView>>;
/** The bell and the feed (GET /api/notifications). */
export type NotificationsView = Awaited<ReturnType<typeof listNotifications>>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the Splits API. Errors come back as ApiError with a message safe to show. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined || init.body instanceof FormData ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "OFFLINE", "Can't reach Splits. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? "Something went wrong");
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.name === "NotAllowedError") return "Face ID or fingerprint was cancelled.";
  return "Something went wrong. Try again.";
}
