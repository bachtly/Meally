import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { households, users } from "./auth.js";
import { images, recipes } from "./recipes.js";

/** Cooking journal: "made it" logs, comments and notes on a recipe. */
export const timelineEvents = sqliteTable(
  "timeline_events",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["made", "comment", "note"] }).notNull(),
    text: text("text"),
    imageId: text("image_id").references(() => images.id, { onDelete: "set null" }),
    rating: integer("rating"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("timeline_recipe_idx").on(t.recipeId, t.createdAt),
    index("timeline_household_idx").on(t.householdId, t.createdAt),
  ],
);
