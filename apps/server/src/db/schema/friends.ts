import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

/** Symmetric Friendship: one row per pair, with `user_a_id < user_b_id`. Friend reads need `status = 'accepted'`. */
export const friendships = pgTable(
  "friendships",
  {
    userAId: text("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userBId: text("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted"] })
      .notNull()
      .default("pending"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    primaryKey({ columns: [t.userAId, t.userBId] }),
    index("friendships_user_b_idx").on(t.userBId),
    check("friendships_order_ck", sql`${t.userAId} < ${t.userBId}`),
    check("friendships_requester_ck", sql`${t.requestedBy} IN (${t.userAId}, ${t.userBId})`),
  ],
);

/** One-time Friendship request link. `id` is public; the token is stored as a sha256 hash. Expires after 7 days. */
export const friendshipInvites = pgTable(
  "friendship_invites",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    usedBy: text("used_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("friendship_invites_token_hash_uq").on(t.tokenHash), index("friendship_invites_creator_idx").on(t.createdBy)],
);
