ALTER TABLE "transfers" ADD COLUMN "payer_tag" text;--> statement-breakpoint
CREATE INDEX "users_tag_prefix" ON "users" USING btree ("tag" text_pattern_ops);--> statement-breakpoint
-- Payments made since Split tags launched keep the tag the payer held at that moment.
UPDATE "transfers" SET "payer_tag" = "split_tags"."tag" FROM "split_tags" WHERE "split_tags"."user_id" = "transfers"."payer_user_id" AND "split_tags"."claimed_at" <= "transfers"."created_at" AND ("split_tags"."retired_at" IS NULL OR "split_tags"."retired_at" > "transfers"."created_at");
