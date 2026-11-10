CREATE TABLE `timeline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`text` text,
	`image_id` text,
	`rating` integer,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `timeline_recipe_idx` ON `timeline_events` (`recipe_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `timeline_household_idx` ON `timeline_events` (`household_id`,`created_at`);