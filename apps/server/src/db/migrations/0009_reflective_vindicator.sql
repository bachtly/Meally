CREATE TABLE `recipe_user_data` (
	`user_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`favourite` integer DEFAULT false NOT NULL,
	`rating` integer,
	`last_made_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `recipe_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_user_data_recipe_idx` ON `recipe_user_data` (`recipe_id`);