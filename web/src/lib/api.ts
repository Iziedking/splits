import type { actionView, receiptView, splitView, transferView, userView, visitorPaymentView, walletView } from "@/server/views";

/** Response shapes, taken from the server's own view functions so the two can't drift apart. */
export type UserView = ReturnType<typeof userView>;
export type WalletView = ReturnType<typeof walletView>;
export type SplitView = ReturnType<typeof splitView>;
export type TransferView = ReturnType<typeof transferView>;
export type ActionView = ReturnType<typeof actionView>;
export type ReceiptView = ReturnType<typeof receiptView>;
export type VisitorPaymentView = ReturnType<typeof visitorPaymentView>;
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
};
/** One router leg as the server hands it to the visitor's wallet. */
export type ContractLeg = { recipient: `0x${string}`; fixedAmount: string; shareBps: 0; purpose: `0x${string}` };
import type { ReceivedItem } from "@/server/services/activity";
export type { ReceivedItem };
export type { CheckLine, PayoutCheck } from "@/server/services/payouts";
export type ActivityView = { sent: TransferView[]; received: ReceivedItem[]; receivedError: string | null };
export type Me = { mode: "preview" | "live"; network: "arc" | "arc-testnet"; user: UserView; wallets: WalletView[] };

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
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
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
