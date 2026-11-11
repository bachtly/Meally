import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { households, users } from "./auth.js";
import { recipes } from "./recipes.js";

/** Public capability links. Only the SHA-256 of the token is stored; the token itself is shown once. */
export const shareLinks = pgTable(
  "share_links",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    viewCount: integer("view_count").notNull().default(0),
  },
  (t) => [uniqueIndex("share_links_token_hash_uq").on(t.tokenHash), index("share_links_recipe_idx").on(t.recipeId)],
);
