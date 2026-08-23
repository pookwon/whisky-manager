ALTER TABLE `automation_settings` ADD `board_id` text;--> statement-breakpoint
UPDATE `automation_settings`
SET `board_id` = COALESCE(
  (SELECT `value` FROM `app_settings` WHERE `key` = 'boardId'),
  '5'
)
WHERE `board_id` IS NULL;
