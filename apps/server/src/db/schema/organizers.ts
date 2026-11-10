import { index, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { households } from "./auth.js";
import { recipes } from "./recipes.js";

function organizer(table: string) {
  return sqliteTable(
    table,
    {
      id: text("id").primaryKey(),
      householdId: text("household_id")
        .notNull()
        .references(() => households.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      slug: text("slug").notNull(),
    },
    (t) => [uniqueIndex(`${table}_household_slug_uq`).on(t.householdId, t.slug)],
  );
}

export const tags = organizer("tags");
export const categories = organizer("categories");
export const tools = organizer("tools");

export const recipeTags = sqliteTable(
  "recipe_tags",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.tagId] }), index("recipe_tags_tag_id_idx").on(t.tagId)],
);

export const recipeCategories = sqliteTable(
  "recipe_categories",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.categoryId] }), index("recipe_categories_category_id_idx").on(t.categoryId)],
);

export const recipeTools = sqliteTable(
  "recipe_tools",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    toolId: text("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.toolId] }), index("recipe_tools_tool_id_idx").on(t.toolId)],
);
