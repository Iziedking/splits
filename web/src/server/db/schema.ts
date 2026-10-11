import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** A person, keyed by email. "invited" users were named as a recipient before they signed in. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  status: text("status", { enum: ["invited", "active"] }).notNull(),
  pinHash: text("pin_hash"),
  pinFailures: integer("pin_failures").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
  createdAt: createdAt(),
});

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind", { enum: ["main", "pocket"] }).notNull(),
    label: text("label").notNull(),
    providerWalletId: text("provider_wallet_id").notNull().unique(),
    address: text("address").notNull().unique(),
    /**
     * The one payment allowed between approve and send. USDC approvals overwrite each other, so
     * two payments from one wallet must not interleave there.
     */
    busyTransferId: uuid("busy_transfer_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("wallets_one_main_per_user").on(t.userId).where(sql`${t.kind} = 'main'`)],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("otp_codes_email").on(t.email, t.createdAt)],
);

export const sessions = pgTable("sessions", {
  /** sha256 of the cookie token; the token itself is never stored. */
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const passkeys = pgTable("passkeys", {
  credentialId: text("credential_id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: jsonb("transports").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

/** Single-use challenge for adding a passkey. Confirmation challenges live on `actions`. */
export const passkeyChallenges = pgTable("passkey_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  challenge: text("challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export type StoredLeg = {
  /** What the owner calls this recipient, e.g. "Landlord". */
  name: string;
  email: string | null;
  walletId: string | null;
  address: string;
  /** USDC base units as a decimal string, "0" for share legs. */
  fixedAmount: string;
  shareBps: number;
  purpose: string;
};

export const splits = pgTable(
  "splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    status: text("status", { enum: ["pending", "active", "paused", "failed"] }).notNull(),
    onchainId: bigint("onchain_id", { mode: "bigint" }),
    version: integer("version").notNull().default(0),
    legs: jsonb("legs").$type<StoredLeg[]>().notNull(),
    /** When set, this split runs automatically on money that lands in this wallet. */
    autoForWalletId: uuid("auto_for_wallet_id").references(() => wallets.id),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("splits_one_rule_per_wallet").on(t.autoForWalletId)],
);

/** Something the user must approve with a PIN or passkey before it runs. */
export const actions = pgTable("actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  type: text("type", { enum: ["create_split", "transfer"] }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  challenge: text("challenge").notNull(),
  status: text("status", { enum: ["pending", "confirmed", "expired"] }).notNull().default("pending"),
  method: text("method", { enum: ["pin", "passkey"] }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const TRANSFER_STATUSES = [
  "awaiting_confirmation",
  "confirmed",
  "funding",
  "approving",
  "sending",
  "verifying",
  "settled",
  "failed",
  "cancelled",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** One payout a payment must make. `email` is set when the recipient was named by email. */
export type ExpectedLeg = { name: string; address: string; amount: string; purpose: string; email?: string | null };

export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payerUserId: uuid("payer_user_id").notNull().references(() => users.id),
    payerWalletId: uuid("payer_wallet_id").notNull().references(() => wallets.id),
    /** "send" pays a saved split, "auto" runs a receiver's rule, "pay" pays a checked list once. */
    kind: text("kind", { enum: ["send", "auto", "pay"] }).notNull(),
    /** Null for one-off ("pay") payments, which have no saved split. */
    splitId: uuid("split_id").references(() => splits.id),
    splitVersion: integer("split_version"),
    amount: text("amount").notNull(),
    quote: jsonb("quote").$type<Record<string, unknown>>(),
    /** USDC base units released from the treasury to cover a simulated card payment. */
    topUp: text("top_up").notNull().default("0"),
    /** Set, under a lock, when the top-up is reserved against the daily caps. */
    fundedAt: timestamp("funded_at", { withTimezone: true }),
    expected: jsonb("expected").$type<ExpectedLeg[]>().notNull(),
    ref: text("ref").notNull().unique(),
    status: text("status", { enum: TRANSFER_STATUSES }).notNull(),
    parentTransferId: uuid("parent_transfer_id"),
    txHash: text("tx_hash"),
    lastError: text("last_error"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("transfers_payer").on(t.payerUserId, t.createdAt),
    // One automatic split per parent payment and wallet, so a replayed trigger can't run it twice.
    uniqueIndex("transfers_one_auto_per_parent").on(t.parentTransferId, t.payerWalletId),
  ],
);

/** Every write sent to the wallet provider, keyed so a retry finds the original. */
export const providerTxs = pgTable(
  "provider_txs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectId: uuid("subject_id").notNull(),
    step: text("step").notNull(),
    attempt: integer("attempt").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    providerTxId: text("provider_tx_id").notNull(),
    status: text("status", { enum: ["pending", "complete", "failed"] }).notNull(),
    rawState: text("raw_state").notNull(),
    txHash: text("tx_hash"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("provider_txs_subject_step_attempt").on(t.subjectId, t.step, t.attempt)],
);

export const webhookEvents = pgTable("webhook_events", {
  notificationId: text("notification_id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: createdAt(),
});

export type DraftLeg = {
  name: string;
  email: string | null;
  walletId: string | null;
  address: string;
  /** USDC base units, whole cents. */
  amount: string;
  purpose: string;
};

/**
 * A payout list that passed its checks. Approving a payment points at a draft, so what gets paid
 * is exactly what was checked; a draft pays at most once.
 */
export const payoutDrafts = pgTable(
  "payout_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    legs: jsonb("legs").$type<DraftLeg[]>().notNull(),
    total: text("total").notNull(),
    hash: text("hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    transferId: uuid("transfer_id"),
    createdAt: createdAt(),
  },
  (t) => [index("payout_drafts_owner").on(t.ownerUserId, t.createdAt)],
);

/** "You received money" emails, one per payment and recipient. */
export const notices = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id").notNull().references(() => transfers.id),
    email: text("email").notNull(),
    amount: text("amount").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Not retried before this time; backs off after each failure. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("notices_one_per_transfer_email").on(t.transferId, t.email), index("notices_status").on(t.status)],
);
