import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { images, recipes } from "./recipes.js";

/** Cooking journal: "made it" logs, comments and notes on a recipe. */
export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["made", "comment", "note"] }).notNull(),
    text: text("text"),
    imageId: text("image_id").references(() => images.id, { onDelete: "set null" }),
    rating: integer("rating"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("timeline_recipe_idx").on(t.recipeId, t.createdAt),
    index("timeline_user_idx").on(t.userId, t.createdAt),
  ],
);
