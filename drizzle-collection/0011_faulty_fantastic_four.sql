CREATE TYPE "public"."attendance_kind" AS ENUM('comment', 'post', 'visit');--> statement-breakpoint
CREATE TYPE "public"."attendance_post_status" AS ENUM('recorded', 'refused');--> statement-breakpoint
CREATE TABLE "attendance_awards" (
	"post_id" text NOT NULL,
	"position" integer NOT NULL,
	"nickname" text NOT NULL,
	CONSTRAINT "attendance_awards_pkey" PRIMARY KEY("post_id","position")
);
--> statement-breakpoint
CREATE TABLE "attendance_posts" (
	"post_id" text PRIMARY KEY NOT NULL,
	"kind" "attendance_kind" NOT NULL,
	"period_start" date,
	"period_end" date,
	"title" text NOT NULL,
	"posted_at" timestamp (3) with time zone NOT NULL,
	"read_at" timestamp (3) with time zone NOT NULL,
	"status" "attendance_post_status" NOT NULL,
	"refusal_rule" text,
	"winner_count" integer,
	CONSTRAINT "attendance_posts_recorded" CHECK (("attendance_posts"."status" = 'recorded') = ("attendance_posts"."refusal_rule" is null and "attendance_posts"."winner_count" is not null and "attendance_posts"."period_start" is not null and "attendance_posts"."period_end" is not null)),
	CONSTRAINT "attendance_posts_period_order" CHECK ("attendance_posts"."period_start" is null or "attendance_posts"."period_end" is null or "attendance_posts"."period_start" <= "attendance_posts"."period_end")
);
--> statement-breakpoint
ALTER TABLE "attendance_awards" ADD CONSTRAINT "attendance_awards_post_id_attendance_posts_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."attendance_posts"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_awards_nickname" ON "attendance_awards" USING btree ("nickname");--> statement-breakpoint
CREATE INDEX "attendance_posts_kind_period" ON "attendance_posts" USING btree ("kind","period_start");