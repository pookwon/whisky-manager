CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_settings` (
	`automation_id` text PRIMARY KEY NOT NULL,
	`policy` text NOT NULL,
	`limits_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`cafe_id` text NOT NULL,
	`board_id` text NOT NULL,
	`target_post_id` text NOT NULL,
	`target_title` text,
	`target_author` text,
	`target_author_id` text,
	`target_posted_at` integer NOT NULL,
	`actor_account` text,
	`status` text NOT NULL,
	`strategy` text,
	`risk_flags` text DEFAULT '[]' NOT NULL,
	`reason` text,
	`template_id` text,
	`rendered_text` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`detected_at` integer NOT NULL,
	`executed_at` integer,
	`resolved_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `executions_cafe_automation_post_unique` ON `executions` (`cafe_id`,`automation_id`,`target_post_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`body` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watermarks` (
	`automation_id` text NOT NULL,
	`cafe_id` text NOT NULL,
	`board_id` text NOT NULL,
	`last_seen_post_id` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watermarks_cafe_automation_board_unique` ON `watermarks` (`cafe_id`,`automation_id`,`board_id`);