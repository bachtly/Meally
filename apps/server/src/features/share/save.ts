import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { imageSizes, recipeInputSchema, type SaveShare, type SaveShareResult, type ShareStatus } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { images, recipeIngredients, recipes, recipeSteps } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import type { ImageStore } from "../../ports/index.js";
import { addToCookbook, createCookbook } from "../cookbooks/service.js";
import { createRecipe } from "../recipes/service.js";
import { findActive, linkRecipeIds, type ShareFlags } from "./service.js";

type RecipeRow = typeof recipes.$inferSelect;
const gone = () => new ApiError(404, "not_found", "This link no longer works");

/** The link and the recipes it currently shows (rows of the sharer's household). */
async function linkRecipes(db: Db, token: string, flags: ShareFlags) {
  const link = await findActive(db, token);
  if (!link) throw gone();
  const ids = await linkRecipeIds(db, link, flags);
  if (!ids) throw gone();
  const rows = ids.length ? await db.select().from(recipes).where(and(eq(recipes.householdId, link.householdId), inArray(recipes.id, ids))) : [];
  return { link, rows };
}

/** Copies the viewer's household already has, keyed by the origin recipe id. */
async function existingCopies(db: Db, householdId: string, originIds: string[]) {
  if (!originIds.length) return new Map<string, string>();
  const rows = await db
    .select({ origin: recipes.originRecipeId, slug: recipes.slug })
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), isNotNull(recipes.originRecipeId), inArray(recipes.originRecipeId, originIds)));
  return new Map(rows.map((r) => [r.origin!, r.slug]));
}

export async function shareStatus(db: Db, householdId: string, token: string, flags: ShareFlags): Promise<ShareStatus> {
  const { link, rows } = await linkRecipes(db, token, flags);
  if (link.householdId === householdId) return { sameHousehold: true, saved: Object.fromEntries(rows.map((r) => [r.slug, r.slug])) };
  const copies = await existingCopies(db, householdId, rows.map((r) => r.id));
  const saved: Record<string, string> = {};
  for (const r of rows) {
    const mine = copies.get(r.id);
    if (mine) saved[r.slug] = mine;
  }
  return { sameHousehold: false, saved };
}

/** Copies the image bytes into the viewer's household under a new id; null when any size is missing. */
async function copyImage(db: Db, store: ImageStore, from: RecipeRow, toHousehold: string) {
  if (!from.imageId) return null;
  const files = [];
  for (const size of imageSizes) {
    const f = await store.get(from.householdId, from.imageId, size);
    if (!f) return null;
    files.push({ size, f });
  }
  const id = randomUUID();
  for (const { size, f } of files) await store.put(toHousehold, id, size, f.bytes, f.contentType);
  await db.insert(images).values({ id, householdId: toHousehold, createdAt: new Date() });
  return id;
}

/**
 * Saves recipes of a link into the viewer's household as independent copies (fields, ingredients, steps, image).
 * Already-saved recipes are not copied twice. Tags, ratings and the sharer's food links are not copied.
 */
export async function saveShare(
  db: Db,
  store: ImageStore,
  viewer: { householdId: string; userId: string },
  token: string,
  body: SaveShare,
  flags: ShareFlags & { foods: boolean },
): Promise<SaveShareResult> {
  const { link, rows } = await linkRecipes(db, token, flags);
  if (link.householdId === viewer.householdId) throw new ApiError(409, "same_household", "These recipes are already in your household");
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const wanted = body.slugs.map((s) => bySlug.get(s));
  if (wanted.some((r) => !r)) throw new ApiError(404, "not_found", "That recipe is no longer in this link");
  const sources = wanted as RecipeRow[];
  const copies = await existingCopies(db, viewer.householdId, sources.map((r) => r.id));
  const saved: Record<string, string> = {};
  const now = new Date();
  for (const src of sources) {
    const have = copies.get(src.id);
    if (have) {
      saved[src.slug] = have;
      continue;
    }
    const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, src.id)).orderBy(asc(recipeIngredients.position));
    const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, src.id)).orderBy(asc(recipeSteps.position));
    const data = recipeInputSchema.parse({
      name: src.name,
      description: src.description,
      yieldText: src.yieldText,
      servings: src.servings,
      prepMinutes: src.prepMinutes,
      cookMinutes: src.cookMinutes,
      totalMinutes: src.totalMinutes,
      sourceUrl: src.sourceUrl,
      notes: src.notes,
      ingredients: ings.map(({ section, quantity, unit, food, note, raw }) => ({ section, quantity, unit, food, note, raw })),
      steps: steps.map(({ section, text }) => ({ section, text })),
    });
    // `foods` relinks ingredients to the viewer's own catalogue; the sharer's food ids never cross over.
    const created = await createRecipe(db, viewer.householdId, viewer.userId, data, { foods: flags.foods });
    const imageId = await copyImage(db, store, src, viewer.householdId);
    await db
      .update(recipes)
      .set({ savedFromName: link.sharerName, savedAt: now, originRecipeId: src.id, ...(imageId ? { imageId } : {}) })
      .where(and(eq(recipes.id, created.id), eq(recipes.householdId, viewer.householdId)));
    saved[src.slug] = created.slug;
  }
  let cookbookSlug: string | null = null;
  if (body.cookbook) {
    if (!flags.cookbooks) throw new ApiError(404, "feature_disabled", "The cookbooks feature is turned off.");
    cookbookSlug =
      "name" in body.cookbook ? (await createCookbook(db, viewer.householdId, { name: body.cookbook.name, kind: "manual" }, {})).slug : body.cookbook.slug;
    for (const slug of Object.values(saved)) await addToCookbook(db, viewer.householdId, cookbookSlug, slug);
  }
  return { saved, cookbookSlug };
}
