CREATE TABLE `feedback_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback_reports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "feedback_attachment_size" CHECK(`byte_size` BETWEEN 1 AND 5242880)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_attachments_feedback_unique` ON `feedback_attachments` (`feedback_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_attachments_r2_key_unique` ON `feedback_attachments` (`r2_key`);
--> statement-breakpoint
CREATE INDEX `idx_feedback_attachments_created` ON `feedback_attachments` (`created_at`);
