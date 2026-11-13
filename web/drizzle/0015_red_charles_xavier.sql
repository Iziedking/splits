CREATE TABLE "near_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "near_profiles_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
ALTER TABLE "near_profiles" ADD CONSTRAINT "near_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;