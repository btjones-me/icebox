CREATE TABLE `sheet_mirror_lock` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `lease_id` text,
  `lease_expires_at` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `sheet_mirror_lock` (`id`, `updated_at`) VALUES (1, CURRENT_TIMESTAMP);
--> statement-breakpoint
PRAGMA optimize;
