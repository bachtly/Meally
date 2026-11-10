import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { households, users } from "./auth.js";
import { recipes } from "./recipes.js";

/** Public capability links. Only the SHA-256 of the token is stored; the token itself is shown once. */
export const shareLinks = sqliteTable(
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
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    viewCount: integer("view_count").notNull().default(0),
  },
  (t) => [uniqueIndex("share_links_token_hash_uq").on(t.tokenHash), index("share_links_recipe_idx").on(t.recipeId)],
);
