import type { TransferStatus, transfers } from "../db/schema";

/** What one step of a payment decided: a new status (and fields), or wait for the next sweep. */
export type StepResult = { status: TransferStatus; patch?: Partial<typeof transfers.$inferSelect> } | "wait";
