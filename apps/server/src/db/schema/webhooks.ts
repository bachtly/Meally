import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { households } from "./auth.js";

export const webhooks = pgTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    dailyAt: text("daily_at").notNull().default("07:00"),
    tz: text("tz").notNull().default("UTC"),
    /** Local date (YYYY-MM-DD in `tz`) of the last digest sent. */
    lastDigestOn: text("last_digest_on"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    lastStatus: integer("last_status"),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true, mode: "date" }),
    failureCount: integer("failure_count").notNull().default(0),
  },
  (t) => [index("webhooks_household_idx").on(t.householdId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    statusCode: integer("status_code"),
    ok: boolean("ok").notNull(),
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)],
);
