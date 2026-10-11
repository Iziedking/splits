CREATE TABLE "rate_hits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_hits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "payout_drafts" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "payer_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "payer_wallet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_drafts" ADD COLUMN "visitor_key_hash" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "payer_address" text;--> statement-breakpoint
UPDATE "transfers" SET "payer_address" = "wallets"."address" FROM "wallets" WHERE "wallets"."id" = "transfers"."payer_wallet_id";--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "payer_address" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "funding" text DEFAULT 'balance' NOT NULL;--> statement-breakpoint
UPDATE "transfers" SET "funding" = 'card' WHERE "top_up" <> '0';--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "fee_amount" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "fee_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "fee_address" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "visitor_token" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "visitor_email" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "from_block" bigint;--> statement-breakpoint
CREATE INDEX "transfers_payer_address" ON "transfers" USING btree ("payer_address","created_at");--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_visitor_token_unique" UNIQUE("visitor_token");--> statement-breakpoint
ALTER TABLE "payout_drafts" ADD CONSTRAINT "payout_drafts_one_owner" CHECK (num_nonnulls("payout_drafts"."owner_user_id", "payout_drafts"."visitor_key_hash") = 1);