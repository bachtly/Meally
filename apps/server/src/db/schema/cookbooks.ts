import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { households } from "./auth.js";
import { recipes } from "./recipes.js";

export const cookbooks = sqliteTable(
  "cookbooks",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    kind: text("kind", { enum: ["smart", "manual"] }).notNull(),
    filter: text("filter", { mode: "json" }),
    coverRecipeId: text("cover_recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("cookbooks_household_slug_uq").on(t.householdId, t.slug)],
);

export const cookbookRecipes = sqliteTable(
  "cookbook_recipes",
  {
    cookbookId: text("cookbook_id")
      .notNull()
      .references(() => cookbooks.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.cookbookId, t.recipeId] }), index("cookbook_recipes_recipe_idx").on(t.recipeId)],
);
