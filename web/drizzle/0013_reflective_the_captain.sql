CREATE TABLE "split_tags" (
	"tag" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tag_changes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "split_tags" ADD CONSTRAINT "split_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "split_tags_user" ON "split_tags" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tag_unique" UNIQUE("tag");