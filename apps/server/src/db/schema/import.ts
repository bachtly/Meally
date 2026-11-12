import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const importJobs = pgTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    filename: text("filename"),
    status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull(),
    total: integer("total").notNull().default(0),
    imported: integer("imported").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    /** Real failure count; `errors` itself is capped at 100 entries. */
    failed: integer("failed").notNull().default(0),
    errors: jsonb("errors").$type<Array<{ item: string; message: string }>>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("import_jobs_user_idx").on(t.userId, t.createdAt)],
);
