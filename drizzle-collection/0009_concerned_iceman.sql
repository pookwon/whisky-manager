CREATE TYPE "public"."article_probe_outcome" AS ENUM('stored', 'deleted', 'unreadable', 'other_board', 'notice');--> statement-breakpoint
ALTER TYPE "public"."collection_feed_kind" ADD VALUE 'article_probe';--> statement-breakpoint
CREATE TABLE "article_probe" (
	"post_id" bigint PRIMARY KEY NOT NULL,
	"window_from_day" text NOT NULL,
	"window_to_day" text NOT NULL,
	"outcome" "article_probe_outcome",
	"board_id" text,
	"error_code" text,
	"probed_at" timestamp (3) with time zone,
	"run_id" uuid,
	CONSTRAINT "article_probe_id" CHECK ("article_probe"."post_id" >= 1),
	CONSTRAINT "article_probe_window" CHECK ("article_probe"."window_from_day" <= "article_probe"."window_to_day"),
	CONSTRAINT "article_probe_answered" CHECK (("article_probe"."outcome" is null) = ("article_probe"."probed_at" is null) and ("article_probe"."outcome" is null) = ("article_probe"."run_id" is null)),
	CONSTRAINT "article_probe_board" CHECK (case when "article_probe"."outcome" in ('stored', 'other_board', 'notice') then "article_probe"."board_id" is not null else "article_probe"."board_id" is null end),
	CONSTRAINT "article_probe_error_code" CHECK (case when "article_probe"."outcome" = 'unreadable' then "article_probe"."error_code" is not null else "article_probe"."error_code" is null end)
);
--> statement-breakpoint
ALTER TABLE "article_probe" ADD CONSTRAINT "article_probe_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;