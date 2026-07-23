ALTER TABLE `friends` ADD `enrollment_mode` text DEFAULT 'authKey' NOT NULL;--> statement-breakpoint
ALTER TABLE `friends` ADD `invite_email` text;--> statement-breakpoint
ALTER TABLE `friends` ADD `invite_id` text;--> statement-breakpoint
ALTER TABLE `friends` ADD `invite_status` text;