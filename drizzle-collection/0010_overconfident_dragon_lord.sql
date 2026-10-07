ALTER TABLE "feed_state" ADD COLUMN "search_extended_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "feed_state" ADD COLUMN "search_finished_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "feed_state" ADD COLUMN "probe_finished_at" timestamp (3) with time zone;