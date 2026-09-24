ALTER TYPE "public"."member_run_kind" ADD VALUE 'resync';--> statement-breakpoint
CREATE TABLE "member_resync_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"anchor_member_key" text,
	"anchor_join_date" date,
	"reference_page" integer,
	"page_identity" text,
	"cycle_started_at" timestamp (3) with time zone,
	"completed_at" timestamp (3) with time zone,
	"last_run_id" uuid,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "member_resync_state_singleton" CHECK ("member_resync_state"."id" = 1),
	CONSTRAINT "member_resync_state_version" CHECK ("member_resync_state"."state_version" >= 0),
	CONSTRAINT "member_resync_state_reference_page" CHECK ("member_resync_state"."reference_page" is null or "member_resync_state"."reference_page" >= 1)
);
--> statement-breakpoint
ALTER TABLE "member_resync_state" ADD CONSTRAINT "member_resync_state_last_run_id_member_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."member_runs"("id") ON DELETE no action ON UPDATE no action;