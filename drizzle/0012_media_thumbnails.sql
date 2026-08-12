ALTER TABLE `media` ADD COLUMN `thumbnail_r2_key` text;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `thumbnail_mime_type` text;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `thumbnail_byte_size` integer;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `thumbnail_width` integer;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `thumbnail_height` integer;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `thumbnail_sha256` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_thumbnail_r2_key` ON `media` (`thumbnail_r2_key`) WHERE `thumbnail_r2_key` IS NOT NULL;
--> statement-breakpoint
PRAGMA optimize;
