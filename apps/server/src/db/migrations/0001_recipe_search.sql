-- Full-text search: maintained by the recipes service (name A, description B, ingredients C).
-- Kept out of the Drizzle schema so selects of recipes do not carry the vector.
ALTER TABLE "recipes" ADD COLUMN "search_vector" tsvector;--> statement-breakpoint
CREATE INDEX "recipes_search_idx" ON "recipes" USING GIN ("search_vector");
