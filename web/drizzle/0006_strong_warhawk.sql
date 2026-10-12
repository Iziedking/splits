CREATE TABLE "deposit_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deposit_wallet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"status" text NOT NULL,
	"burn_amount" text NOT NULL,
	"max_fee" text,
	"approve_provider_tx" text,
	"burn_provider_tx" text,
	"burn_tx_hash" text,
	"message" text,
	"attestation" text,
	"nonce" text,
	"mint_provider_tx" text,
	"mint_tx_hash" text,
	"minted_amount" text,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"stuck_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"provider_wallet_id" text NOT NULL,
	"address" text NOT NULL,
	"polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_wallets_provider_wallet_id_unique" UNIQUE("provider_wallet_id")
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"deposit_wallet_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"source_tx_id" text NOT NULL,
	"source_tx_hash" text NOT NULL,
	"amount" text NOT NULL,
	"status" text NOT NULL,
	"move_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_source_tx_id_unique" UNIQUE("source_tx_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"amount" text,
	"read_at" timestamp with time zone,
	"email" text DEFAULT 'none' NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_next_at" timestamp with time zone,
	"email_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "deposit_moves" ADD CONSTRAINT "deposit_moves_deposit_wallet_id_deposit_wallets_id_fk" FOREIGN KEY ("deposit_wallet_id") REFERENCES "public"."deposit_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_moves" ADD CONSTRAINT "deposit_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_wallets" ADD CONSTRAINT "deposit_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_deposit_wallet_id_deposit_wallets_id_fk" FOREIGN KEY ("deposit_wallet_id") REFERENCES "public"."deposit_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_moves_one_active" ON "deposit_moves" USING btree ("deposit_wallet_id") WHERE "deposit_moves"."status" in ('burning', 'attesting', 'minting');--> statement-breakpoint
CREATE INDEX "deposit_moves_status" ON "deposit_moves" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_wallets_one_per_chain" ON "deposit_wallets" USING btree ("user_id","chain");--> statement-breakpoint
CREATE INDEX "deposits_wallet_status" ON "deposits" USING btree ("deposit_wallet_id","status");--> statement-breakpoint
CREATE INDEX "deposits_user_created" ON "deposits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_one_per_event" ON "notifications" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE INDEX "notifications_user_created" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_email" ON "notifications" USING btree ("email");