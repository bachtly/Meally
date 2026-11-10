CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`status_code` integer,
	`ok` integer NOT NULL,
	`error` text,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_hook_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`daily_at` text DEFAULT '07:00' NOT NULL,
	`tz` text DEFAULT 'UTC' NOT NULL,
	`last_digest_on` text,
	`created_at` integer NOT NULL,
	`last_status` integer,
	`last_delivery_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_household_idx` ON `webhooks` (`household_id`);