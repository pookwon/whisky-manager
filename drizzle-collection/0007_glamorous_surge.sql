ALTER TYPE "public"."collection_feed_kind" ADD VALUE 'board_search';--> statement-breakpoint
CREATE TABLE "board_search_state" (
	"board_id" text NOT NULL,
	"query" text NOT NULL,
	"from_day" text NOT NULL,
	"to_day" text NOT NULL,
	"queue_order" integer NOT NULL,
	"expected_gain" integer NOT NULL,
	"last_committed_page" integer,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer,
	"last_run_id" uuid,
	"completed_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "board_search_state_pkey" PRIMARY KEY("board_id","query"),
	CONSTRAINT "board_search_state_window" CHECK ("board_search_state"."from_day" <= "board_search_state"."to_day"),
	CONSTRAINT "board_search_state_queue_order" CHECK ("board_search_state"."queue_order" >= 1),
	CONSTRAINT "board_search_state_counts" CHECK ("board_search_state"."expected_gain" >= 0 and "board_search_state"."inserted_count" >= 0 and ("board_search_state"."total_count" is null or "board_search_state"."total_count" >= 0)),
	CONSTRAINT "board_search_state_page" CHECK ("board_search_state"."last_committed_page" is null or "board_search_state"."last_committed_page" >= 1)
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "search_query" text;--> statement-breakpoint
ALTER TABLE "board_search_state" ADD CONSTRAINT "board_search_state_board_id_boards_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("board_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_search_state" ADD CONSTRAINT "board_search_state_last_run_id_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;