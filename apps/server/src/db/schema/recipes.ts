import type { Nutrition } from "@meally/shared";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { foods } from "./foods.js";

/** Stored image metadata; the files live under $DATA_DIR/images/<userId>/. */
export const images = pgTable("images", {
  id: text("id").primaryKey(),
  userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    yieldText: text("yield_text"),
    servings: doublePrecision("servings"),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    totalMinutes: integer("total_minutes"),
    sourceUrl: text("source_url"),
    notes: text("notes"),
    nutrition: jsonb("nutrition").$type<Nutrition>(),
    imageId: text("image_id").references(() => images.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Saved from a share link: the sharer's name as the link showed it (null when hidden) and when it was saved. */
    savedFromName: text("saved_from_name"),
    savedAt: timestamp("saved_at", { withTimezone: true, mode: "date" }),
    /** The shared recipe this is a copy of, of another user. Internal (dedupe only); no FK, never returned. */
    originRecipeId: text("origin_recipe_id"),
  },
  (t) => [
    uniqueIndex("recipes_user_slug_uq").on(t.userId, t.slug),
    index("recipes_user_updated_idx").on(t.userId, t.updatedAt),
    index("recipes_user_origin_idx").on(t.userId, t.originRecipeId),
  ],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    section: text("section"),
    quantity: doublePrecision("quantity"),
    unit: text("unit"),
    food: text("food"),
    /** Set only while the foods-units flag is on. */
    foodId: text("food_id").references(() => foods.id, { onDelete: "set null" }),
    note: text("note"),
    /** The original line, always kept. */
    raw: text("raw").notNull(),
  },
  (t) => [index("recipe_ingredients_recipe_idx").on(t.recipeId, t.position)],
);

export const recipeSteps = pgTable(
  "recipe_steps",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    section: text("section"),
    text: text("text").notNull(),
  },
  (t) => [index("recipe_steps_recipe_idx").on(t.recipeId, t.position)],
);

/** Per-user favourite and rating for a recipe (ratings flag). Averages are computed from these rows. */
export const recipeUserData = pgTable(
  "recipe_user_data",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    favourite: boolean("favourite").notNull().default(false),
    rating: integer("rating"),
    lastMadeAt: timestamp("last_made_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.recipeId] }), index("recipe_user_data_recipe_idx").on(t.recipeId)],
);
