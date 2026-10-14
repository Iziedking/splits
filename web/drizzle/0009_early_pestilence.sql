CREATE TABLE "earn_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pocket_wallet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" text NOT NULL,
	"status" text NOT NULL,
	"tx_hash" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "earn" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "earn_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "earn_moves" ADD CONSTRAINT "earn_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earn_moves" ADD CONSTRAINT "earn_moves_pocket_wallet_id_wallets_id_fk" FOREIGN KEY ("pocket_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "earn_moves_user" ON "earn_moves" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "earn_moves_status" ON "earn_moves" USING btree ("status");