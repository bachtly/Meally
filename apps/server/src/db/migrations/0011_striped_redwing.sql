CREATE TABLE `cookbook_recipes` (
	`cookbook_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`cookbook_id`, `recipe_id`),
	FOREIGN KEY (`cookbook_id`) REFERENCES `cookbooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cookbook_recipes_recipe_idx` ON `cookbook_recipes` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `cookbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`filter` text,
	`cover_recipe_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cover_recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cookbooks_household_slug_uq` ON `cookbooks` (`household_id`,`slug`);