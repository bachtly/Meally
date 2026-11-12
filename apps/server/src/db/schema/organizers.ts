import { index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { recipes } from "./recipes.js";

function organizer(table: string) {
  return pgTable(
    table,
    {
      id: text("id").primaryKey(),
      userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      slug: text("slug").notNull(),
    },
    (t) => [uniqueIndex(`${table}_user_slug_uq`).on(t.userId, t.slug)],
  );
}

export const tags = organizer("tags");
export const categories = organizer("categories");
export const tools = organizer("tools");

export const recipeTags = pgTable(
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

export const recipeCategories = pgTable(
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

export const recipeTools = pgTable(
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
