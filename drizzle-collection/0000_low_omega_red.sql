CREATE TYPE "public"."collection_board_kind" AS ENUM('normal', 'memo', 'special', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."collection_feed_kind" AS ENUM('all_articles');--> statement-breakpoint
CREATE TYPE "public"."collection_run_kind" AS ENUM('development', 'backfill', 'incremental');--> statement-breakpoint
CREATE TYPE "public"."collection_run_status" AS ENUM('running', 'succeeded', 'partial', 'failed', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."collection_metric_source" AS ENUM('list', 'detail');--> statement-breakpoint
CREATE TYPE "public"."collection_posted_precision" AS ENUM('day', 'minute', 'millisecond');--> statement-breakpoint
CREATE TABLE "cafe_boards" (
	"cafe_id" text NOT NULL,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "collection_board_kind" DEFAULT 'unknown' NOT NULL,
	"collect_enabled" boolean DEFAULT true NOT NULL,
	"discovered_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone NOT NULL,
	"retired_at" timestamp (3) with time zone,
	CONSTRAINT "cafe_boards_pkey" PRIMARY KEY("cafe_id","board_id")
);
--> statement-breakpoint
CREATE TABLE "cafe_posts" (
	"cafe_id" text NOT NULL,
	"post_id" text NOT NULL,
	"board_id" text NOT NULL,
	"title" text,
	"prefix" text,
	"author_nickname" text,
	"author_id" text,
	"posted_date_kst" date NOT NULL,
	"posted_at" timestamp (3) with time zone,
	"posted_precision" "collection_posted_precision" NOT NULL,
	"first_seen_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone NOT NULL,
	"last_observed_run_id" uuid,
	"unavailable_at" timestamp (3) with time zone,
	CONSTRAINT "cafe_posts_pkey" PRIMARY KEY("cafe_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "collection_feed_state" (
	"cafe_id" text NOT NULL,
	"feed_kind" "collection_feed_kind" NOT NULL,
	"menu_id" text NOT NULL,
	"target_start_ms" bigint NOT NULL,
	"target_end_ms" bigint NOT NULL,
	"page_size" integer DEFAULT 50 NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"anchor_post_id" text,
	"anchor_posted_date_kst" date,
	"first_post_id" text,
	"last_post_id" text,
	"page_identity" text,
	"reference_page" integer,
	"last_run_id" uuid,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "collection_feed_state_pkey" PRIMARY KEY("cafe_id","feed_kind","menu_id"),
	CONSTRAINT "collection_feed_state_version" CHECK ("collection_feed_state"."state_version" >= 0),
	CONSTRAINT "collection_feed_state_target_range" CHECK ("collection_feed_state"."target_start_ms" < "collection_feed_state"."target_end_ms"),
	CONSTRAINT "collection_feed_state_page_size" CHECK ("collection_feed_state"."page_size" between 1 and 50),
	CONSTRAINT "collection_feed_state_reference_page" CHECK ("collection_feed_state"."reference_page" is null or "collection_feed_state"."reference_page" >= 1)
);
--> statement-breakpoint
CREATE TABLE "collection_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cafe_id" text NOT NULL,
	"feed_kind" "collection_feed_kind" NOT NULL,
	"menu_id" text NOT NULL,
	"run_kind" "collection_run_kind" NOT NULL,
	"resume_from_checkpoint" boolean DEFAULT false NOT NULL,
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
	"in_range_post_count" integer DEFAULT 0 NOT NULL,
	"inserted_post_count" integer DEFAULT 0 NOT NULL,
	"updated_post_count" integer DEFAULT 0 NOT NULL,
	"duplicate_post_count" integer DEFAULT 0 NOT NULL,
	"failed_post_count" integer DEFAULT 0 NOT NULL,
	"last_committed_anchor_post_id" text,
	"last_committed_page" integer,
	CONSTRAINT "collection_runs_target_range" CHECK ("collection_runs"."target_start_ms" < "collection_runs"."target_end_ms"),
	CONSTRAINT "collection_runs_last_page" CHECK ("collection_runs"."last_committed_page" is null or "collection_runs"."last_committed_page" >= 1),
	CONSTRAINT "collection_runs_nonnegative_counts" CHECK ("collection_runs"."discovery_pages" >= 0 and "collection_runs"."collection_pages" >= 0 and "collection_runs"."request_pages" >= 0 and "collection_runs"."observed_post_count" >= 0 and "collection_runs"."in_range_post_count" >= 0 and "collection_runs"."inserted_post_count" >= 0 and "collection_runs"."updated_post_count" >= 0 and "collection_runs"."duplicate_post_count" >= 0 and "collection_runs"."failed_post_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "post_metric_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cafe_id" text NOT NULL,
	"post_id" text NOT NULL,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"view_count" bigint,
	"like_count" bigint,
	"comment_count" bigint,
	"collection_run_id" uuid NOT NULL,
	"source" "collection_metric_source" NOT NULL,
	"parser_version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cafe_posts" ADD CONSTRAINT "cafe_posts_last_observed_run_id_collection_runs_id_fk" FOREIGN KEY ("last_observed_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cafe_posts" ADD CONSTRAINT "cafe_posts_board_fk" FOREIGN KEY ("cafe_id","board_id") REFERENCES "public"."cafe_boards"("cafe_id","board_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_feed_state" ADD CONSTRAINT "collection_feed_state_last_run_id_collection_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metric_observations" ADD CONSTRAINT "post_metric_observations_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metric_observations" ADD CONSTRAINT "post_metric_observations_post_fk" FOREIGN KEY ("cafe_id","post_id") REFERENCES "public"."cafe_posts"("cafe_id","post_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cafe_posts_board_date" ON "cafe_posts" USING btree ("cafe_id","board_id","posted_date_kst");--> statement-breakpoint
CREATE INDEX "cafe_posts_author_date" ON "cafe_posts" USING btree ("cafe_id","author_id","posted_date_kst");--> statement-breakpoint
CREATE INDEX "cafe_posts_prefix_date" ON "cafe_posts" USING btree ("cafe_id","prefix","posted_date_kst");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_runs_one_running_feed" ON "collection_runs" USING btree ("cafe_id","feed_kind","menu_id") WHERE "collection_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "collection_runs_feed_status" ON "collection_runs" USING btree ("cafe_id","feed_kind","menu_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "post_metric_observations_run_post_source" ON "post_metric_observations" USING btree ("collection_run_id","cafe_id","post_id","source");--> statement-breakpoint
CREATE INDEX "post_metric_observations_post_observed" ON "post_metric_observations" USING btree ("cafe_id","post_id","observed_at");