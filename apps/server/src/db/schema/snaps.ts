import { index, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { images, recipes } from "./recipes.js";

/** One Snap: a photo of what a user cooked or ate. The Linked recipe is optional and owned by the author. */
export const snaps = pgTable(
  "snaps",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    /** Client-generated; makes a retried send idempotent per user. */
    clientId: text("client_id").notNull(),
    caption: text("caption"),
    dishName: text("dish_name"),
    place: text("place"),
    recipeId: text("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    uniqueIndex("snaps_user_client_uq").on(t.userId, t.clientId),
    /** Feed: keyset on (created_at, id). */
    index("snaps_feed_idx").on(t.userId, t.createdAt.desc(), t.id),
    index("snaps_recipe_idx").on(t.recipeId),
    index("snaps_image_idx").on(t.imageId),
  ],
);

/**
 * One Reaction per user per Snap per key. DELETE sets `removed_at` and keeps the row, so the push for a
 * (Snap, user, key) is sent once even after DELETE then PUT. Readers filter on `removed_at IS NULL`.
 */
export const reactions = pgTable(
  "reactions",
  {
    snapId: text("snap_id")
      .notNull()
      .references(() => snaps.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [primaryKey({ columns: [t.snapId, t.userId, t.emoji] }), index("reactions_user_idx").on(t.userId)],
);
