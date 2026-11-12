-- Rekey every household-owned row to the household's single user (ADR 0003) and drop households.
-- Hand-written: a generated diff would drop and re-add the columns. The snapshot matches the new TS schema.
-- The whole file runs in one transaction, so the abort below leaves the database untouched.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (SELECT household_id FROM "users" GROUP BY household_id HAVING count(*) > 1) multi;
  IF n > 0 THEN
    RAISE EXCEPTION 'Cannot upgrade: % household(s) have more than one member. Split each household so it has one user, then restart. Nothing was changed.', n;
  END IF;
END
$$;
--> statement-breakpoint
-- A household with no member has no owner to rekey to; its data was already unreachable, so it goes (cascades).
DELETE FROM "households" h WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u.household_id = h.id);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "images" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "images" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "recipes" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "recipes" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "recipes" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "categories" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "tags" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tags" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "tools" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "tools" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tools" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cookbooks" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "cookbooks" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "cookbooks" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "cookbooks" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "cookbooks" ADD CONSTRAINT "cookbooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "meal_plan_entries" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "meal_plan_entries" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meal_plan_rules" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "meal_plan_rules" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "meal_plan_rules" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "meal_plan_rules" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "meal_plan_rules" ADD CONSTRAINT "meal_plan_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "aisle_labels" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "aisle_labels" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "aisle_labels" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "aisle_labels" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "aisle_labels" ADD CONSTRAINT "aisle_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "shopping_lists" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "shopping_lists" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shopping_lists" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "shopping_items" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "shopping_items" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shopping_items" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_aisles" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "food_aisles" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "food_aisles" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "food_aisles" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "food_aisles" ADD CONSTRAINT "food_aisles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "share_links" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "share_links" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "share_links" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "webhooks" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhooks" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "custom_units" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "custom_units" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "custom_units" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_units" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "custom_units" ADD CONSTRAINT "custom_units_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "foods" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "foods" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "foods" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
UPDATE "timeline_events" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "timeline_events" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "timeline_events" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "timeline_events" DROP CONSTRAINT "timeline_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
UPDATE "import_jobs" t SET "user_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_tokens" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "household_feed_tokens" RENAME TO "user_feed_tokens";
--> statement-breakpoint
ALTER TABLE "user_feed_tokens" DROP CONSTRAINT "household_feed_tokens_household_id_households_id_fk";
--> statement-breakpoint
UPDATE "user_feed_tokens" t SET "household_id" = (SELECT u.id FROM "users" u WHERE u.household_id = t.household_id);
--> statement-breakpoint
ALTER TABLE "user_feed_tokens" RENAME COLUMN "household_id" TO "user_id";
--> statement-breakpoint
ALTER TABLE "user_feed_tokens" RENAME CONSTRAINT "household_feed_tokens_pkey" TO "user_feed_tokens_pkey";
--> statement-breakpoint
ALTER INDEX "household_feed_tokens_token_uq" RENAME TO "user_feed_tokens_token_uq";
--> statement-breakpoint
ALTER TABLE "user_feed_tokens" ADD CONSTRAINT "user_feed_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DROP TABLE "invites";
--> statement-breakpoint
CREATE TABLE "image_moves" (
	"household_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_moves" ADD CONSTRAINT "image_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Remember where each household's image files are, so the startup step can move them after this file drops households.
INSERT INTO "image_moves" ("household_id", "user_id") SELECT household_id, id FROM "users";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "household_id";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "household_role";
--> statement-breakpoint
DROP TABLE "households";
--> statement-breakpoint
ALTER TABLE "food_aisles" ADD CONSTRAINT "food_aisles_user_id_food_pk" PRIMARY KEY("user_id","food");
--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_user_slug_uq" ON "recipes" USING btree ("user_id","slug");
--> statement-breakpoint
CREATE INDEX "recipes_user_updated_idx" ON "recipes" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX "recipes_user_origin_idx" ON "recipes" USING btree ("user_id","origin_recipe_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_slug_uq" ON "categories" USING btree ("user_id","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_slug_uq" ON "tags" USING btree ("user_id","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "tools_user_slug_uq" ON "tools" USING btree ("user_id","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "cookbooks_user_slug_uq" ON "cookbooks" USING btree ("user_id","slug");
--> statement-breakpoint
CREATE INDEX "meal_plan_entries_user_date_idx" ON "meal_plan_entries" USING btree ("user_id","date");
--> statement-breakpoint
CREATE INDEX "meal_plan_rules_user_idx" ON "meal_plan_rules" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "aisle_labels_user_idx" ON "aisle_labels" USING btree ("user_id","position");
--> statement-breakpoint
CREATE INDEX "shopping_lists_user_idx" ON "shopping_lists" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "share_links_user_idx" ON "share_links" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "webhooks_user_idx" ON "webhooks" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_units_user_key_uq" ON "custom_units" USING btree ("user_id","key");
--> statement-breakpoint
CREATE INDEX "foods_user_idx" ON "foods" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "import_jobs_user_idx" ON "import_jobs" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "timeline_user_idx" ON "timeline_events" USING btree ("user_id","created_at");
