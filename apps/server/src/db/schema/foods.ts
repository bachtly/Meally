import { doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { households } from "./auth.js";
import { aisleLabels } from "./shopping.js";

const hh = () =>
  text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" });

/** The household's food catalogue. `name` is unique per household, case-insensitively (enforced in the service). */
export const foods = pgTable(
  "foods",
  {
    id: text("id").primaryKey(),
    householdId: hh(),
    name: text("name").notNull(),
    pluralName: text("plural_name"),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    aisleId: text("aisle_id").references(() => aisleLabels.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("foods_household_idx").on(t.householdId)],
);

/** Household-defined units on top of the built-in UNITS. `key` is what recipes store in `unit`. */
export const customUnits = pgTable(
  "custom_units",
  {
    id: text("id").primaryKey(),
    householdId: hh(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    plural: text("plural").notNull(),
    abbreviation: text("abbreviation"),
    kind: text("kind").notNull().default("count"),
    factor: doublePrecision("factor"),
  },
  (t) => [uniqueIndex("custom_units_household_key_uq").on(t.householdId, t.key)],
);
