CREATE TABLE `activity` (
	`friend_id` integer PRIMARY KEY NOT NULL,
	`requests_total` integer DEFAULT 0 NOT NULL,
	`requests_by_op` text DEFAULT '{}' NOT NULL,
	`requests_24h` integer DEFAULT 0 NOT NULL,
	`last_request_at` text,
	`last_op` text,
	`bytes_in_total` integer DEFAULT 0 NOT NULL,
	`bytes_out_total` integer DEFAULT 0 NOT NULL,
	`denied_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`friend_id`) REFERENCES `friends`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`friend_id` integer,
	`action` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`friend_id`) REFERENCES `friends`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_friend_created` ON `audit` (`friend_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `friends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`isolation_mode` text NOT NULL,
	`instance_id` integer NOT NULL,
	`bucket` text NOT NULL,
	`quota_bytes` integer NOT NULL,
	`lock_mode` text DEFAULT 'GOVERNANCE' NOT NULL,
	`lock_retention_days` integer NOT NULL,
	`s3_access_key_id` text,
	`ts_node_tag` text NOT NULL,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_friends_name` ON `friends` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_friends_instance_bucket` ON `friends` (`instance_id`,`bucket`);--> statement-breakpoint
CREATE INDEX `idx_friends_instance` ON `friends` (`instance_id`);--> statement-breakpoint
CREATE INDEX `idx_friends_status` ON `friends` (`status`);--> statement-breakpoint
CREATE TABLE `instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`minio_port` integer NOT NULL,
	`ts_hostname` text NOT NULL,
	`ts_tag` text NOT NULL,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_instances_minio_port` ON `instances` (`minio_port`);--> statement-breakpoint
CREATE INDEX `idx_instances_kind_status` ON `instances` (`kind`,`status`);--> statement-breakpoint
CREATE TABLE `usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`friend_id` integer NOT NULL,
	`bytes_used` integer NOT NULL,
	`object_count` integer NOT NULL,
	`checked_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`friend_id`) REFERENCES `friends`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_usage_friend_checked` ON `usage` (`friend_id`,`checked_at`);