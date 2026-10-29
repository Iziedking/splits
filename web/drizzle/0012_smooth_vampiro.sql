CREATE TABLE "support_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ref" text,
	"status" text NOT NULL,
	"handed_over_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"tool" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposit_moves" ADD COLUMN "resume_status" text;--> statement-breakpoint
ALTER TABLE "deposit_moves" ADD COLUMN "resumes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_chats" ADD CONSTRAINT "support_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_chat_id_support_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."support_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_chats_user" ON "support_chats" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "support_messages_chat" ON "support_messages" USING btree ("chat_id","created_at");