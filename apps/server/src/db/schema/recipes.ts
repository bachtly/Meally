import type { Nutrition } from "@meally/shared";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { households, users } from "./auth.js";

/** Stored image metadata; the files live under $DATA_DIR/images/<householdId>/. */
export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const recipes = sqliteTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    yieldText: text("yield_text"),
    servings: real("servings"),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    totalMinutes: integer("total_minutes"),
    sourceUrl: text("source_url"),
    notes: text("notes"),
    nutrition: text("nutrition", { mode: "json" }).$type<Nutrition>(),
    imageId: text("image_id").references(() => images.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("recipes_household_slug_uq").on(t.householdId, t.slug),
    index("recipes_household_updated_idx").on(t.householdId, t.updatedAt),
  ],
);

export const recipeIngredients = sqliteTable(
  "recipe_ingredients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    section: text("section"),
    quantity: real("quantity"),
    unit: text("unit"),
    food: text("food"),
    note: text("note"),
    /** The original line, always kept. */
    raw: text("raw").notNull(),
  },
  (t) => [index("recipe_ingredients_recipe_idx").on(t.recipeId, t.position)],
);

export const recipeSteps = sqliteTable(
  "recipe_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    section: text("section"),
    text: text("text").notNull(),
  },
  (t) => [index("recipe_steps_recipe_idx").on(t.recipeId, t.position)],
);

/** Per-user favourite and rating for a recipe (ratings flag). Household averages are computed from these rows. */
export const recipeUserData = sqliteTable(
  "recipe_user_data",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    favourite: integer("favourite", { mode: "boolean" }).notNull().default(false),
    rating: integer("rating"),
    lastMadeAt: integer("last_made_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.recipeId] }), index("recipe_user_data_recipe_idx").on(t.recipeId)],
);
