PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `feedback_attachments_relaxed` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL CHECK (`byte_size` > 0),
	`width` integer,
	`height` integer,
	`sha256` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `feedback_attachments_relaxed`
  (`id`, `feedback_id`, `r2_key`, `mime_type`, `byte_size`, `width`, `height`, `sha256`, `created_at`)
SELECT `id`, `feedback_id`, `r2_key`, `mime_type`, `byte_size`, `width`, `height`, `sha256`, `created_at`
FROM `feedback_attachments`;
--> statement-breakpoint
DROP TABLE `feedback_attachments`;
--> statement-breakpoint
ALTER TABLE `feedback_attachments_relaxed` RENAME TO `feedback_attachments`;
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_attachments_feedback_unique` ON `feedback_attachments` (`feedback_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_attachments_r2_key_unique` ON `feedback_attachments` (`r2_key`);
--> statement-breakpoint
CREATE INDEX `idx_feedback_attachments_created` ON `feedback_attachments` (`created_at`);
--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
--> statement-breakpoint
PRAGMA foreign_key_check;
--> statement-breakpoint
PRAGMA optimize;
