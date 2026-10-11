CREATE TABLE "receipt_links" (
	"token" text PRIMARY KEY NOT NULL,
	"transfer_id" uuid NOT NULL,
	"leg_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_links_one_per_leg" ON "receipt_links" USING btree ("transfer_id","leg_index");