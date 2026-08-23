ALTER TABLE `automation_settings` ADD `board_id` text;--> statement-breakpoint
-- '5' is DEFAULT_BOARD_ID in src/desktop/session.ts.
UPDATE `automation_settings`
SET `board_id` = COALESCE(
  (SELECT `value` FROM `app_settings` WHERE `key` = 'boardId'),
  '5'
)
WHERE `board_id` IS NULL;
