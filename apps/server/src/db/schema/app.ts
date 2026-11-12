import { pgTable, text } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value"),
});

/**
 * Image folders still to move from `<householdId>/` to `<userId>/` after the rekey migration (ADR 0003).
 * The startup step (and the `images.move` job on the edge) copies the files, then deletes the row. Drop this
 * table in a later release, once no instance has rows left.
 */
export const imageMoves = pgTable("image_moves", {
  householdId: text("household_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});
