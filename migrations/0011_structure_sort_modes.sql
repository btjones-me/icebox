ALTER TABLE `freezers` ADD COLUMN `default_sort_mode` text NOT NULL DEFAULT 'added'
  CHECK (`default_sort_mode` IN ('added', 'alphabetical', 'expiry'));
--> statement-breakpoint
ALTER TABLE `drawers` ADD COLUMN `default_sort_mode` text NOT NULL DEFAULT 'added'
  CHECK (`default_sort_mode` IN ('added', 'alphabetical', 'expiry'));
