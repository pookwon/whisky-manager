CREATE TYPE "public"."collection_feed_kind" AS ENUM('all_articles', 'notices', 'recommended');--> statement-breakpoint
CREATE TYPE "public"."collection_run_kind" AS ENUM('development', 'backfill', 'incremental');--> statement-breakpoint
CREATE TYPE "public"."collection_run_status" AS ENUM('running', 'succeeded', 'partial', 'failed', 'interrupted');--> statement-breakpoint
CREATE TABLE "boards" (
	"board_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"collect_enabled" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"feed_kind" "collection_feed_kind" NOT NULL,
	"menu_id" text NOT NULL,
	"run_kind" "collection_run_kind" NOT NULL,
	"target_start_ms" bigint NOT NULL,
	"target_end_ms" bigint NOT NULL,
	"status" "collection_run_status" DEFAULT 'running' NOT NULL,
	"stop_reason" text,
	"started_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"discovery_pages" integer DEFAULT 0 NOT NULL,
	"collection_pages" integer DEFAULT 0 NOT NULL,
	"request_pages" integer DEFAULT 0 NOT NULL,
	"observed_post_count" integer DEFAULT 0 NOT NULL,
	"inserted_post_count" integer DEFAULT 0 NOT NULL,
	"updated_post_count" integer DEFAULT 0 NOT NULL,
	"last_committed_post_id" text,
	"last_committed_page" integer,
	CONSTRAINT "runs_target_range" CHECK ("runs"."target_start_ms" < "runs"."target_end_ms"),
	CONSTRAINT "runs_last_page" CHECK ("runs"."last_committed_page" is null or "runs"."last_committed_page" >= 1),
	CONSTRAINT "runs_nonnegative_counts" CHECK ("runs"."discovery_pages" >= 0 and "runs"."collection_pages" >= 0 and "runs"."request_pages" >= 0 and "runs"."observed_post_count" >= 0 and "runs"."inserted_post_count" >= 0 and "runs"."updated_post_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "feed_state" (
	"feed_kind" "collection_feed_kind" NOT NULL,
	"menu_id" text NOT NULL,
	"target_start_ms" bigint NOT NULL,
	"target_end_ms" bigint NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"anchor_post_id" text,
	"anchor_posted_at" timestamp (3) with time zone,
	"page_identity" text,
	"reference_page" integer,
	"last_run_id" uuid,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "feed_state_pkey" PRIMARY KEY("feed_kind","menu_id"),
	CONSTRAINT "feed_state_version" CHECK ("feed_state"."state_version" >= 0),
	CONSTRAINT "feed_state_target_range" CHECK ("feed_state"."target_start_ms" < "feed_state"."target_end_ms"),
	CONSTRAINT "feed_state_reference_page" CHECK ("feed_state"."reference_page" is null or "feed_state"."reference_page" >= 1)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"post_id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"prefix" text,
	"title" text,
	"author_id" text,
	"author_nickname" text,
	"posted_at" timestamp (3) with time zone NOT NULL,
	"view_count" bigint,
	"comment_count" bigint,
	"snapshot_at" timestamp (3) with time zone NOT NULL,
	"first_seen_at" timestamp (3) with time zone NOT NULL,
	"last_run_id" uuid,
	CONSTRAINT "posts_nonnegative_counts" CHECK (("posts"."view_count" is null or "posts"."view_count" >= 0) and ("posts"."comment_count" is null or "posts"."comment_count" >= 0))
);
--> statement-breakpoint
ALTER TABLE "feed_state" ADD CONSTRAINT "feed_state_last_run_id_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_board_id_boards_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("board_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_last_run_id_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_running_feed" ON "runs" USING btree ("feed_kind","menu_id") WHERE "runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "runs_feed_status" ON "runs" USING btree ("feed_kind","menu_id","status");--> statement-breakpoint
CREATE INDEX "posts_posted_at" ON "posts" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "posts_board_posted_at" ON "posts" USING btree ("board_id","posted_at");--> statement-breakpoint
CREATE INDEX "posts_author_posted_at" ON "posts" USING btree ("author_id","posted_at");