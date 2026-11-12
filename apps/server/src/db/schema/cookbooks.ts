import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { recipes } from "./recipes.js";

export const cookbooks = pgTable(
  "cookbooks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    kind: text("kind", { enum: ["smart", "manual"] }).notNull(),
    filter: jsonb("filter"),
    coverRecipeId: text("cover_recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("cookbooks_user_slug_uq").on(t.userId, t.slug)],
);

export const cookbookRecipes = pgTable(
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
