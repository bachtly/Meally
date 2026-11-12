import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { cookbooks } from "./cookbooks.js";
import { recipes } from "./recipes.js";

/**
 * Public capability links. Only the SHA-256 of the token is stored; the token itself is shown once.
 * A link targets one recipe, a hand-picked set (`share_link_recipes`) or a cookbook (live).
 */
export const shareLinks = pgTable(
  "share_links",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["recipe", "set", "cookbook"] }).notNull().default("recipe"),
    recipeId: text("recipe_id").references(() => recipes.id, { onDelete: "cascade" }),
    cookbookId: text("cookbook_id").references(() => cookbooks.id, { onDelete: "cascade" }),
    /** Set links only; cookbook and recipe links show their target's current name. */
    title: text("title"),
    note: text("note"),
    /** Snapshot of the sharer's name at creation, or null when they chose not to show it. Never a user id. */
    sharerName: text("sharer_name"),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    viewCount: integer("view_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("share_links_token_hash_uq").on(t.tokenHash),
    index("share_links_recipe_idx").on(t.recipeId),
    index("share_links_user_idx").on(t.userId),
    check(
      "share_links_target_ck",
      sql`(${t.kind} = 'recipe' AND ${t.recipeId} IS NOT NULL AND ${t.cookbookId} IS NULL)
        OR (${t.kind} = 'set' AND ${t.recipeId} IS NULL AND ${t.cookbookId} IS NULL)
        OR (${t.kind} = 'cookbook' AND ${t.cookbookId} IS NOT NULL AND ${t.recipeId} IS NULL)`,
    ),
  ],
);

/** The recipes of a set link, in the sharer's order. A deleted recipe drops out of the set. */
export const shareLinkRecipes = pgTable(
  "share_link_recipes",
  {
    shareLinkId: text("share_link_id")
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shareLinkId, t.recipeId] }), index("share_link_recipes_recipe_idx").on(t.recipeId)],
);
