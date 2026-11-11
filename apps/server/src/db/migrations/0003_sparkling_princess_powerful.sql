CREATE TABLE "share_link_recipes" (
	"share_link_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "share_link_recipes_share_link_id_recipe_id_pk" PRIMARY KEY("share_link_id","recipe_id")
);
--> statement-breakpoint
ALTER TABLE "share_links" ALTER COLUMN "recipe_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "kind" text DEFAULT 'recipe' NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "cookbook_id" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "sharer_name" text;--> statement-breakpoint
ALTER TABLE "share_link_recipes" ADD CONSTRAINT "share_link_recipes_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_recipes" ADD CONSTRAINT "share_link_recipes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_link_recipes_recipe_idx" ON "share_link_recipes" USING btree ("recipe_id");--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_cookbook_id_cookbooks_id_fk" FOREIGN KEY ("cookbook_id") REFERENCES "public"."cookbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_links_household_idx" ON "share_links" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_target_ck" CHECK (("share_links"."kind" = 'recipe' AND "share_links"."recipe_id" IS NOT NULL AND "share_links"."cookbook_id" IS NULL)
        OR ("share_links"."kind" = 'set' AND "share_links"."recipe_id" IS NULL AND "share_links"."cookbook_id" IS NULL)
        OR ("share_links"."kind" = 'cookbook' AND "share_links"."cookbook_id" IS NOT NULL AND "share_links"."recipe_id" IS NULL));