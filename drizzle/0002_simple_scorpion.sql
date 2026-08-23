CREATE TABLE `members` (
	`cafe_id` text NOT NULL,
	`member_key` text NOT NULL,
	`join_date` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_cafe_member_unique` ON `members` (`cafe_id`,`member_key`);