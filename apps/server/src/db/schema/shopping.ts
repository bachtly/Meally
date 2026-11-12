import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

const hh = () =>
  text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" });
const ts = (n: string) => timestamp(n, { withTimezone: true, mode: "date" }).notNull();

export const aisleLabels = pgTable(
  "aisle_labels",
  { id: text("id").primaryKey(), userId: hh(), name: text("name").notNull(), position: integer("position").notNull(), color: text("color") },
  (t) => [index("aisle_labels_user_idx").on(t.userId, t.position)],
);

export const shoppingLists = pgTable(
  "shopping_lists",
  { id: text("id").primaryKey(), userId: hh(), name: text("name").notNull(), createdAt: ts("created_at"), updatedAt: ts("updated_at") },
  (t) => [index("shopping_lists_user_idx").on(t.userId)],
);

export const shoppingItems = pgTable(
  "shopping_items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    userId: hh(),
    text: text("text").notNull(),
    quantity: doublePrecision("quantity"),
    unit: text("unit"),
    food: text("food"),
    note: text("note"),
    aisle: text("aisle").references(() => aisleLabels.id, { onDelete: "set null" }),
    checked: boolean("checked").notNull().default(false),
    position: integer("position").notNull().default(0),
    /** JSON array of {slug, name}: the recipes that contributed. */
    recipeRefs: jsonb("recipe_refs").$type<Array<{ slug: string; name: string }>>().notNull().default([]),
    updatedAt: ts("updated_at"),
  },
  (t) => [index("shopping_items_list_idx").on(t.listId, t.position)],
);

/** Remembers which aisle a food goes in; `food` is the normalised name. */
export const foodAisles = pgTable(
  "food_aisles",
  {
    userId: hh(),
    food: text("food").notNull(),
    aisleId: text("aisle_id")
      .notNull()
      .references(() => aisleLabels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.food] })],
);
