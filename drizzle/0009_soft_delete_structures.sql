ALTER TABLE `freezers` ADD COLUMN `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `drawers` ADD COLUMN `deleted_at` text;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_freezers_household_position`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_drawers_freezer_position`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_freezers_household_position` ON `freezers` (`household_id`, `position`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_drawers_freezer_position` ON `drawers` (`freezer_id`, `position`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_freezers_household_active` ON `freezers` (`household_id`, `deleted_at`, `position`);
--> statement-breakpoint
CREATE INDEX `idx_drawers_freezer_active` ON `drawers` (`freezer_id`, `deleted_at`, `position`);
--> statement-breakpoint
PRAGMA optimize;
