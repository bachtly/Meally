ALTER TABLE "recipes" ADD COLUMN "saved_from_name" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "origin_recipe_id" text;--> statement-breakpoint
CREATE INDEX "recipes_household_origin_idx" ON "recipes" USING btree ("household_id","origin_recipe_id");