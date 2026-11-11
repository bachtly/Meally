import { randomUUID } from "node:crypto";
import type { ImageStore } from "../../ports/index.js";
import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import type { ImageSize, Nutrition, Recipe, RecipeData, RecipeListResponse, RecipeSummary } from "@meally/shared";
import { isNutritionEmpty } from "@meally/shared";
import { ms, type Db } from "../../db/core.js";
import { images, recipeIngredients, recipes, recipeSteps, recipeUserData, timelineEvents } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import { getMe, householdRating } from "../ratings/service.js";
import { linkFoods } from "../foods/service.js";
import { hasAnyOf, loadRefs, setRecipeOrganizers } from "../organizers/service.js";

/** `org` is true when the organizers flag is on; when off, organiser fields are ignored and omitted. */
type Org = { org?: boolean; userId?: string; ratings?: boolean; timeline?: boolean; nutrition?: boolean; foods?: boolean };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = typeof recipes.$inferSelect;

import { emitWebhookEvent } from "../webhooks/events.js";

export const imageUrl = (id: string | null, size: ImageSize) => (id ? `/api/v1/images/${id}/${size}` : null);

export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return s || "recipe";
}

async function uniqueSlug(tx: Tx, householdId: string, name: string): Promise<string> {
  const base = slugify(name);
  const rows = await tx
    .select({ slug: recipes.slug })
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), or(eq(recipes.slug, base), like(recipes.slug, `${base}-%`))));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** The search vector (name A, description B, ingredients C) is written here, in the same transaction as the recipe. */
async function reindex(tx: Tx, householdId: string, id: string, data: RecipeData) {
  const ingredients = data.ingredients.map((i) => [i.raw, i.food].filter(Boolean).join(" ")).join(" ");
  await tx.execute(
    sql`UPDATE recipes SET search_vector =
          setweight(to_tsvector('simple', ${data.name}), 'A') ||
          setweight(to_tsvector('simple', ${data.description ?? ""}), 'B') ||
          setweight(to_tsvector('simple', ${ingredients}), 'C')
        WHERE id = ${id} AND household_id = ${householdId}`,
  );
}

async function writeChildren(tx: Tx, householdId: string, id: string, data: RecipeData, o: Org) {
  await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
  await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, id));
  if (data.ingredients.length) {
    const foodIds = o.foods ? await linkFoods(tx, householdId, data.ingredients.map((i) => i.food)) : [];
    await tx
      .insert(recipeIngredients)
      .values(data.ingredients.map((i, position) => ({ ...i, foodId: foodIds[position] ?? null, recipeId: id, position })));
  }
  if (data.steps.length)
    await tx.insert(recipeSteps).values(data.steps.map((s, position) => ({ ...s, recipeId: id, position })));
}

const fields = (d: RecipeData) => ({
  name: d.name,
  description: d.description,
  yieldText: d.yieldText,
  servings: d.servings,
  prepMinutes: d.prepMinutes,
  cookMinutes: d.cookMinutes,
  totalMinutes: d.totalMinutes,
  sourceUrl: d.sourceUrl,
  notes: d.notes,
});

/** Column values for nutrition: only when the flag is on and the input has the field. Empty input clears it. */
function nutritionCols(d: RecipeData, o: Org): { nutrition?: Nutrition | null } {
  if (!o.nutrition || d.nutrition === undefined) return {};
  return { nutrition: d.nutrition === null || isNutritionEmpty(d.nutrition) ? null : d.nutrition };
}

async function writeOrganizers(tx: Tx, householdId: string, id: string, data: RecipeData) {
  if (data.tags) await setRecipeOrganizers(tx, "tags", householdId, id, data.tags);
  if (data.categories) await setRecipeOrganizers(tx, "categories", householdId, id, data.categories);
  if (data.tools) await setRecipeOrganizers(tx, "tools", householdId, id, data.tools);
}

async function load(db: Pick<Db, "select">, row: Row, o: Org = {}): Promise<Recipe> {
  const org = o.org;
  const rate =
    o.ratings && o.userId
      ? { me: await getMe(db, o.userId, row.id), householdRating: await householdRating(db, row.householdId, row.id) }
      : {};
  const extra = org
    ? {
        tags: (await loadRefs(db, "tags", [row.id])).get(row.id) ?? [],
        categories: (await loadRefs(db, "categories", [row.id])).get(row.id) ?? [],
        tools: (await loadRefs(db, "tools", [row.id])).get(row.id) ?? [],
      }
    : {};
  Object.assign(extra, rate);
  if (o.nutrition) Object.assign(extra, { nutrition: row.nutrition ?? null });
  const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, row.id)).orderBy(asc(recipeIngredients.position));
  const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, row.id)).orderBy(asc(recipeSteps.position));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    yieldText: row.yieldText,
    servings: row.servings,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    totalMinutes: row.totalMinutes,
    sourceUrl: row.sourceUrl,
    notes: row.notes,
    imageUrl: imageUrl(row.imageId, 800),
    ingredients: ings.map(({ position, section, quantity, unit, food, note, raw }) => ({ position, section, quantity, unit, food, note, raw })),
    steps: steps.map(({ position, section, text }) => ({ position, section, text })),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    ...extra,
  };
}

export async function findRow(db: Pick<Db, "select">, householdId: string, slug: string): Promise<Row> {
  const [row] = await db.select().from(recipes).where(and(eq(recipes.householdId, householdId), eq(recipes.slug, slug))).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Recipe not found");
  return row;
}

export async function createRecipe(db: Db, householdId: string, userId: string, data: RecipeData, o: Org = {}): Promise<Recipe> {
  const now = new Date();
  const id = randomUUID();
  const row = await db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, householdId, data.name);
    const [row] = await tx
      .insert(recipes)
      .values({ id, householdId, slug, ...fields(data), ...nutritionCols(data, o), createdBy: userId, createdAt: now, updatedAt: now })
      .returning();
    await writeChildren(tx, householdId, id, data, o);
    if (o.org) await writeOrganizers(tx, householdId, id, data);
    await reindex(tx, householdId, id, data);
    return row!;
  });
  emitWebhookEvent(db, householdId, "recipe.created", { slug: row.slug, name: row.name });
  return load(db, row, o);
}

export async function getRecipe(db: Db, householdId: string, slug: string, o: Org = {}): Promise<Recipe> {
  return load(db, await findRow(db, householdId, slug), o);
}

/** Replaces the recipe fields, ingredients and steps in one transaction. The slug never changes. */
export async function replaceRecipe(db: Db, householdId: string, slug: string, data: RecipeData, o: Org = {}): Promise<Recipe> {
  const row = await db.transaction(async (tx) => {
    const existing = await findRow(tx, householdId, slug);
    const [row] = await tx
      .update(recipes)
      .set({ ...fields(data), ...nutritionCols(data, o), updatedAt: new Date() })
      .where(and(eq(recipes.id, existing.id), eq(recipes.householdId, householdId)))
      .returning();
    await writeChildren(tx, householdId, existing.id, data, o);
    if (o.org) await writeOrganizers(tx, householdId, existing.id, data);
    await reindex(tx, householdId, existing.id, data);
    return row!;
  });
  emitWebhookEvent(db, householdId, "recipe.updated", { slug: row.slug, name: row.name });
  return load(db, row, o);
}

export async function deleteRecipe(db: Db, store: ImageStore, householdId: string, slug: string) {
  const extra: string[] = [];
  let deleted = { slug, name: "" };
  const imageId = await db.transaction(async (tx) => {
    const existing = await findRow(tx, householdId, slug);
    deleted = { slug: existing.slug, name: existing.name };
    const tlImgs = (await tx.select({ id: timelineEvents.imageId }).from(timelineEvents).where(eq(timelineEvents.recipeId, existing.id)))
      .map((r) => r.id)
      .filter((x): x is string => !!x);
    extra.push(...tlImgs);
    await tx.delete(recipes).where(and(eq(recipes.id, existing.id), eq(recipes.householdId, householdId)));
    if (existing.imageId) await tx.delete(images).where(eq(images.id, existing.imageId));
    if (tlImgs.length) await tx.delete(images).where(inArray(images.id, tlImgs));
    return existing.imageId;
  });
  emitWebhookEvent(db, householdId, "recipe.deleted", deleted);
  if (imageId) await store.delete(householdId, imageId);
  for (const id of extra) await store.delete(householdId, id);
}

/**
 * Free text to a tsquery: words are matched exactly (websearch syntax: quotes, -, or), except the last
 * word, which matches as a prefix when the text ends on it (type-ahead). Null when there is nothing to search.
 */
export function searchQuery(q: string): SQL | null {
  if (!/[\p{L}\p{N}]/u.test(q)) return null;
  const m = q.match(/^(.*?)([\p{L}\p{N}]+)$/su);
  // No prefix after a minus (exclusion) or inside an unclosed quote: let websearch parse it whole.
  if (!m || m[1]!.endsWith("-") || (m[1]!.match(/"/g)?.length ?? 0) % 2 === 1) return sql`websearch_to_tsquery('simple', ${q})`;
  const head = m[1]!.trim();
  const prefix = sql`to_tsquery('simple', ${`${m[2]!}:*`})`;
  return head ? sql`(websearch_to_tsquery('simple', ${head}) && ${prefix})` : prefix;
}

export const encode = (v: string | number, id: string) => Buffer.from(JSON.stringify([v, id])).toString("base64url");
export function decode(cursor: string): [string | number, string] {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (Array.isArray(v) && v.length === 2 && ["string", "number"].includes(typeof v[0]) && typeof v[1] === "string")
      return v as [string | number, string];
  } catch {
    /* fall through */
  }
  throw new ApiError(400, "invalid_cursor", "Invalid cursor");
}

export async function listRecipes(
  db: Db,
  householdId: string,
  opts: {
    q?: string;
    sort: "updated" | "name" | "created" | "rating" | "last-made";
    favourites?: boolean;
    minRating?: number;
    cursor?: string;
    limit: number;
    tag?: string[];
    category?: string[];
    tool?: string[];
    /** Restrict to these recipe ids (used by manual cookbooks). */
    ids?: string[];
  } & Org,
): Promise<RecipeListResponse> {
  const conds: SQL[] = [eq(recipes.householdId, householdId)];
  if (opts.ids) conds.push(inArray(recipes.id, opts.ids));
  if (opts.q) {
    const match = searchQuery(opts.q);
    if (match === null) return { items: [], nextCursor: null };
    conds.push(sql`"recipes"."search_vector" @@ ${match}`);
  }
  // OR within a type, AND across types. Ignored when the flag is off.
  if (opts.org) {
    if (opts.tag?.length) conds.push(hasAnyOf("tags", householdId, opts.tag, recipes.id));
    if (opts.category?.length) conds.push(hasAnyOf("categories", householdId, opts.category, recipes.id));
    if (opts.tool?.length) conds.push(hasAnyOf("tools", householdId, opts.tool, recipes.id));
  }
  // Ratings are the caller's own; every ratings option is ignored when the flag is off.
  const rt = !!(opts.ratings && opts.userId);
  if (rt && opts.favourites) conds.push(eq(recipeUserData.favourite, true));
  if (rt && opts.minRating) conds.push(sql`${recipeUserData.rating} >= ${opts.minRating}`);
  // Keyset pagination on (sort key, id). updated/created/rating are highest or newest first; name is A to Z.
  const sort = (opts.sort === "rating" && !rt) || (opts.sort === "last-made" && !opts.timeline) ? "updated" : opts.sort;
  const tl = !!opts.timeline;
  const lastMadeSql = sql`(SELECT (extract(epoch from max(created_at)) * 1000)::double precision FROM timeline_events te WHERE te.recipe_id = ${recipes.id} AND te.kind = 'made')`;
  const madeCountSql = sql`(SELECT count(*) FROM timeline_events te WHERE te.recipe_id = ${recipes.id} AND te.kind = 'made')`;
  const key =
    sort === "last-made" && tl
      ? sql`coalesce(${lastMadeSql}, 0)`
      : sort === "name"
      ? sql`lower(${recipes.name})`
      : sort === "created"
        ? ms(recipes.createdAt)
        : sort === "rating"
          ? sql`coalesce(${recipeUserData.rating}, 0)`
          : ms(recipes.updatedAt);
  const ascending = sort === "name";
  if (opts.cursor) {
    const [v, id] = decode(opts.cursor);
    const op = ascending ? sql`>` : sql`<`;
    conds.push(sql`(${key} ${op} ${v} OR (${key} = ${v} AND ${recipes.id} ${op} ${id}))`);
  }
  const dir = ascending ? asc : desc;
  const rows = await db
    .select({ row: recipes, k: sql<string | number>`${key}`.as("k"), fav: recipeUserData.favourite, rating: recipeUserData.rating, lm: tl ? lastMadeSql : sql<null>`null`, mc: tl ? madeCountSql : sql<null>`null` })
    .from(recipes)
    .leftJoin(recipeUserData, and(eq(recipeUserData.recipeId, recipes.id), eq(recipeUserData.userId, opts.userId ?? "")))
    .where(and(...conds))
    .orderBy(dir(key), dir(recipes.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  const ids = page.map(({ row }) => row.id);
  const tagMap = opts.org ? await loadRefs(db, "tags", ids) : null;
  const catMap = opts.org ? await loadRefs(db, "categories", ids) : null;
  const items: RecipeSummary[] = page.map(({ row, fav, rating, lm, mc }) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    imageUrl: imageUrl(row.imageId, 320),
    totalMinutes: row.totalMinutes,
    servings: row.servings,
    updatedAt: row.updatedAt.getTime(),
    ...(rt ? { favourite: fav ?? false, rating: rating ?? null } : {}),
    ...(tl ? { lastMadeAt: lm == null ? null : Number(lm), madeCount: Number(mc ?? 0) } : {}),
    ...(tagMap && catMap ? { tags: tagMap.get(row.id) ?? [], categories: catMap.get(row.id) ?? [] } : {}),
  }));
  return { items, nextCursor: rows.length > opts.limit && last ? encode(last.k, last.row.id) : null };
}

// ---- images ----

/** Stores a new image and points the recipe at it. */
export async function setRecipeImage(db: Db, store: ImageStore, householdId: string, slug: string, input: Buffer): Promise<string> {
  const row = await findRow(db, householdId, slug);
  const id = await store.putOriginal(householdId, input);
  await db.transaction(async (tx) => {
    await tx.insert(images).values({ id, householdId, createdAt: new Date() });
    await tx
      .update(recipes)
      .set({ imageId: id, updatedAt: new Date() })
      .where(and(eq(recipes.id, row.id), eq(recipes.householdId, householdId)));
    if (row.imageId) await tx.delete(images).where(eq(images.id, row.imageId));
  });
  if (row.imageId) await store.delete(householdId, row.imageId);
  return id;
}

export async function findImage(db: Db, householdId: string, id: string) {
  const [img] = await db.select().from(images).where(and(eq(images.id, id), eq(images.householdId, householdId))).limit(1);
  return img ?? null;
}
