import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { households, users } from "./auth.js";
import { recipes } from "./recipes.js";

export const mealPlanEntries = sqliteTable(
  "meal_plan_entries",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    mealType: text("meal_type").notNull(),
    recipeId: text("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    title: text("title"),
    note: text("note"),
    position: integer("position").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("meal_plan_entries_household_date_idx").on(t.householdId, t.date), index("meal_plan_entries_recipe_idx").on(t.recipeId)],
);

export const mealPlanRules = sqliteTable(
  "meal_plan_rules",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** A meal type or 'any'. */
    mealType: text("meal_type").notNull(),
    /** 0 = Sunday .. 6 = Saturday, or null for every day. */
    dayOfWeek: integer("day_of_week"),
    /** JSON string arrays of organiser slugs. */
    tagSlugs: text("tag_slugs").notNull().default("[]"),
    categorySlugs: text("category_slugs").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("meal_plan_rules_household_idx").on(t.householdId)],
);

export const householdFeedTokens = sqliteTable(
  "household_feed_tokens",
  {
    householdId: text("household_id")
      .primaryKey()
      .references(() => households.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("household_feed_tokens_token_uq").on(t.token)],
);
