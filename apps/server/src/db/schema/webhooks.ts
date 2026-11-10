import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { households } from "./auth.js";

export const webhooks = sqliteTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events", { mode: "json" }).$type<string[]>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    dailyAt: text("daily_at").notNull().default("07:00"),
    tz: text("tz").notNull().default("UTC"),
    /** Local date (YYYY-MM-DD in `tz`) of the last digest sent. */
    lastDigestOn: text("last_digest_on"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastStatus: integer("last_status"),
    lastDeliveryAt: integer("last_delivery_at", { mode: "timestamp_ms" }),
    failureCount: integer("failure_count").notNull().default(0),
  },
  (t) => [index("webhooks_household_idx").on(t.householdId)],
);

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    statusCode: integer("status_code"),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)],
);
