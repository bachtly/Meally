CREATE TABLE `household_feed_tokens` (
	`household_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_feed_tokens_token_uq` ON `household_feed_tokens` (`token`);--> statement-breakpoint
CREATE TABLE `meal_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`date` text NOT NULL,
	`meal_type` text NOT NULL,
	`recipe_id` text,
	`title` text,
	`note` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `meal_plan_entries_household_date_idx` ON `meal_plan_entries` (`household_id`,`date`);--> statement-breakpoint
CREATE INDEX `meal_plan_entries_recipe_idx` ON `meal_plan_entries` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `meal_plan_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`meal_type` text NOT NULL,
	`day_of_week` integer,
	`tag_slugs` text DEFAULT '[]' NOT NULL,
	`category_slugs` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meal_plan_rules_household_idx` ON `meal_plan_rules` (`household_id`);