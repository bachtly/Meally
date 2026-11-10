-- Full-text index over recipe name, description and ingredient text.
-- Kept in sync by the recipes service (see docs/design/features/recipes.md), not by triggers.
CREATE VIRTUAL TABLE `recipes_fts` USING fts5(
  `recipe_id` UNINDEXED,
  `household_id` UNINDEXED,
  `name`,
  `description`,
  `ingredients`,
  tokenize = 'unicode61 remove_diacritics 2'
);
