import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

/** One Web Push subscription per browser. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

/** Pending push sends, claimed by a job (lease via next_at) and deleted when sent or given up, like `webhook_retries`. */
export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    /** The JSON body to send, at most 2 KB. */
    payload: jsonb("payload").notNull(),
    /** Retries already scheduled before this one (0 = first send). */
    attempt: integer("attempt").notNull().default(0),
    nextAt: timestamp("next_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("push_deliveries_due_idx").on(t.nextAt)],
);
