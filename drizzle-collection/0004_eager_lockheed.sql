ALTER TYPE "public"."collection_feed_kind" ADD VALUE 'board';--> statement-breakpoint
ALTER TABLE "feed_state" ADD COLUMN "queue_order" integer;--> statement-breakpoint
ALTER TABLE "feed_state" ADD COLUMN "horizon_reached_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "feed_state" ADD CONSTRAINT "feed_state_queue_order" CHECK ("feed_state"."queue_order" is null or "feed_state"."queue_order" >= 1);