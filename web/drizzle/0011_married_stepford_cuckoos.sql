CREATE TABLE "cross_payments" (
	"transfer_id" uuid PRIMARY KEY NOT NULL,
	"chain" text NOT NULL,
	"burn_amount" text NOT NULL,
	"max_fee" text NOT NULL,
	"fast" boolean NOT NULL,
	"hook_hash" text NOT NULL,
	"source_from_block" bigint NOT NULL,
	"phase" text NOT NULL,
	"burn_tx_hash" text,
	"burn_nonce" integer,
	"message" text,
	"attestation" text,
	"nonce" text,
	"relay_provider_tx" text,
	"relay_tx_hash" text,
	"fee_back" text,
	"refund_amount" text,
	"slow_route" boolean DEFAULT false NOT NULL,
	"attention_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cross_payments" ADD CONSTRAINT "cross_payments_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cross_payments_burn_tx" ON "cross_payments" USING btree ("burn_tx_hash");--> statement-breakpoint
CREATE INDEX "cross_payments_phase" ON "cross_payments" USING btree ("phase");