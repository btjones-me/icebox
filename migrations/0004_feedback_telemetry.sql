CREATE TABLE `feedback_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`user_id` text NOT NULL,
	`household_id` text,
	`session_id` text NOT NULL,
	`message` text NOT NULL,
	`app_context_json` text NOT NULL,
	`recent_events_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_reports_reference_unique` ON `feedback_reports` (`reference`);
--> statement-breakpoint
CREATE INDEX `idx_feedback_reports_created` ON `feedback_reports` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_feedback_reports_session` ON `feedback_reports` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `app_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`household_id` text,
	`session_id` text NOT NULL,
	`client_request_id` text,
	`event_type` text NOT NULL,
	`level` text NOT NULL,
	`route` text,
	`method` text,
	`status_code` integer,
	`duration_ms` integer,
	`metadata_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_app_events_created` ON `app_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_app_events_session` ON `app_events` (`session_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_app_events_request` ON `app_events` (`client_request_id`);
