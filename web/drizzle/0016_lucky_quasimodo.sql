CREATE TABLE "near_contacts" (
	"owner_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "near_contacts_owner_id_account_id_pk" PRIMARY KEY("owner_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "near_contacts" ADD CONSTRAINT "near_contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;