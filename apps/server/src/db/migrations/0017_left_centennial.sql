CREATE TABLE `custom_units` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`plural` text NOT NULL,
	`abbreviation` text,
	`kind` text DEFAULT 'count' NOT NULL,
	`factor` real,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_units_household_key_uq` ON `custom_units` (`household_id`,`key`);--> statement-breakpoint
CREATE TABLE `foods` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`plural_name` text,
	`aliases` text DEFAULT '[]' NOT NULL,
	`aisle_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`aisle_id`) REFERENCES `aisle_labels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `foods_household_idx` ON `foods` (`household_id`);--> statement-breakpoint
ALTER TABLE `recipe_ingredients` ADD `food_id` text REFERENCES foods(id);