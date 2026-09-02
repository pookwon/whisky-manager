CREATE TYPE "public"."member_run_kind" AS ENUM('backfill', 'incremental', 'topup');--> statement-breakpoint
CREATE TABLE "member_feed_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"anchor_member_key" text,
	"anchor_join_date" date,
	"reference_page" integer,
	"page_identity" text,
	"total_member_count" bigint,
	"completed_at" timestamp (3) with time zone,
	"topped_up_at" timestamp (3) with time zone,
	"forced_at" timestamp (3) with time zone,
	"last_run_id" uuid,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "member_feed_state_singleton" CHECK ("member_feed_state"."id" = 1),
	CONSTRAINT "member_feed_state_version" CHECK ("member_feed_state"."state_version" >= 0),
	CONSTRAINT "member_feed_state_reference_page" CHECK ("member_feed_state"."reference_page" is null or "member_feed_state"."reference_page" >= 1),
	CONSTRAINT "member_feed_state_total" CHECK ("member_feed_state"."total_member_count" is null or "member_feed_state"."total_member_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "member_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_kind" "member_run_kind" NOT NULL,
	"status" "collection_run_status" DEFAULT 'running' NOT NULL,
	"stop_reason" text,
	"started_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"discovery_pages" integer DEFAULT 0 NOT NULL,
	"collection_pages" integer DEFAULT 0 NOT NULL,
	"request_pages" integer DEFAULT 0 NOT NULL,
	"observed_member_count" integer DEFAULT 0 NOT NULL,
	"inserted_member_count" integer DEFAULT 0 NOT NULL,
	"updated_member_count" integer DEFAULT 0 NOT NULL,
	"last_committed_member_key" text,
	"last_committed_page" integer,
	CONSTRAINT "member_runs_last_page" CHECK ("member_runs"."last_committed_page" is null or "member_runs"."last_committed_page" >= 1),
	CONSTRAINT "member_runs_nonnegative_counts" CHECK ("member_runs"."discovery_pages" >= 0 and "member_runs"."collection_pages" >= 0 and "member_runs"."request_pages" >= 0 and "member_runs"."observed_member_count" >= 0 and "member_runs"."inserted_member_count" >= 0 and "member_runs"."updated_member_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "members" (
	"member_key" text PRIMARY KEY NOT NULL,
	"nickname" text,
	"join_date" date NOT NULL,
	"level_name" text NOT NULL,
	"is_manager" boolean NOT NULL,
	"is_staff" boolean NOT NULL,
	"snapshot_at" timestamp (3) with time zone NOT NULL,
	"first_seen_at" timestamp (3) with time zone NOT NULL,
	"last_run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "member_feed_state" ADD CONSTRAINT "member_feed_state_last_run_id_member_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."member_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_last_run_id_member_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."member_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_runs_one_running" ON "member_runs" USING btree ("status") WHERE "member_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "member_runs_status" ON "member_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "members_join_date" ON "members" USING btree ("join_date");--> statement-breakpoint
CREATE INDEX "members_level_name" ON "members" USING btree ("level_name");