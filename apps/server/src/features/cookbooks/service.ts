import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNotNull, like, max, or } from "drizzle-orm";
import type { Cookbook, CookbookFilter, CookbookInput, RecipeListResponse } from "@meally/shared";
import { cookbookFilterSchema } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { cookbookRecipes, cookbooks, recipes } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import { imageUrl, listRecipes, slugify } from "../recipes/service.js";

/** Per-request options of the recipes list service (organizers and ratings flags, the caller). */
export type ListOpts = { org?: boolean; ratings?: boolean; userId?: string };
type Row = typeof cookbooks.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const notFound = () => new ApiError(404, "not_found", "Cookbook not found");
const SMART_CAP = 100;

async function freeSlug(tx: Tx, householdId: string, name: string, ignoreId?: string) {
  const base = slugify(name).replace(/^recipe$/, "cookbook");
  const rows = await tx
    .select({ id: cookbooks.id, slug: cookbooks.slug })
    .from(cookbooks)
    .where(and(eq(cookbooks.householdId, householdId), or(eq(cookbooks.slug, base), like(cookbooks.slug, `${base}-%`))));
  const taken = new Set(rows.filter((r) => r.id !== ignoreId).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

async function find(db: Db, householdId: string, slug: string): Promise<Row> {
  const [row] = await db.select().from(cookbooks).where(and(eq(cookbooks.householdId, householdId), eq(cookbooks.slug, slug)));
  if (!row) throw notFound();
  return row;
}

async function recipeBySlug(db: Db, householdId: string, slug: string) {
  const [r] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), eq(recipes.slug, slug)));
  if (!r) throw new ApiError(404, "not_found", "Recipe not found");
  return r.id;
}

const filterOf = (row: Row): CookbookFilter => cookbookFilterSchema.parse(row.filter ?? {});

/** The library's list service with a smart cookbook's saved filter. Same code path as `GET /recipes`. */
function smartList(db: Db, householdId: string, f: CookbookFilter, o: ListOpts, extra: { cursor?: string; limit: number }) {
  return listRecipes(db, householdId, {
    q: f.q,
    tag: f.tag,
    category: f.category,
    tool: f.tool,
    favourites: f.favourites,
    minRating: f.minRating,
    sort: "updated",
    ...extra,
    ...o,
  });
}

async function toCookbook(db: Db, householdId: string, row: Row, o: ListOpts): Promise<Cookbook> {
  let imgs: { slug: string; url: string }[] = [];
  let n = 0;
  let capped = false;
  if (row.kind === "smart") {
    const res = await smartList(db, householdId, filterOf(row), o, { limit: SMART_CAP });
    n = res.items.length;
    capped = res.nextCursor !== null;
    imgs = res.items.filter((i) => i.imageUrl).map((i) => ({ slug: i.slug, url: i.imageUrl! }));
  } else {
    const [c] = await db.select({ n: count() }).from(cookbookRecipes).where(eq(cookbookRecipes.cookbookId, row.id));
    n = c?.n ?? 0;
    const rs = await db
      .select({ slug: recipes.slug, imageId: recipes.imageId })
      .from(cookbookRecipes)
      .innerJoin(recipes, eq(recipes.id, cookbookRecipes.recipeId))
      .where(and(eq(cookbookRecipes.cookbookId, row.id), isNotNull(recipes.imageId)))
      .orderBy(asc(cookbookRecipes.position))
      .limit(4);
    imgs = rs.map((r) => ({ slug: r.slug, url: imageUrl(r.imageId, 320)! }));
  }
  let coverSlug: string | null = null;
  if (row.coverRecipeId) {
    const [r] = await db.select({ slug: recipes.slug, imageId: recipes.imageId }).from(recipes).where(eq(recipes.id, row.coverRecipeId));
    if (r) {
      coverSlug = r.slug;
      if (r.imageId) imgs = [{ slug: r.slug, url: imageUrl(r.imageId, 320)! }, ...imgs.filter((i) => i.slug !== r.slug)];
    }
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    kind: row.kind,
    filter: row.kind === "smart" ? filterOf(row) : null,
    coverRecipe: coverSlug,
    covers: imgs.slice(0, 4).map((i) => i.url),
    count: n,
    countCapped: capped,
  };
}

export async function listCookbooks(db: Db, householdId: string, o: ListOpts): Promise<Cookbook[]> {
  const rows = await db
    .select()
    .from(cookbooks)
    .where(eq(cookbooks.householdId, householdId))
    .orderBy(asc(cookbooks.position), asc(cookbooks.createdAt));
  return Promise.all(rows.map((r) => toCookbook(db, householdId, r, o)));
}

export async function getCookbook(db: Db, householdId: string, slug: string, o: ListOpts) {
  return toCookbook(db, householdId, await find(db, householdId, slug), o);
}

export async function createCookbook(db: Db, householdId: string, data: CookbookInput, o: ListOpts) {
  const coverRecipeId = data.coverRecipe ? await recipeBySlug(db, householdId, data.coverRecipe) : null;
  const slug = await db.transaction(async (tx) => {
    const slug = await freeSlug(tx, householdId, data.name);
    const [m] = await tx.select({ m: max(cookbooks.position) }).from(cookbooks).where(eq(cookbooks.householdId, householdId));
    await tx.insert(cookbooks).values({
      id: randomUUID(),
      householdId,
      name: data.name,
      slug,
      description: data.description || null,
      kind: data.kind,
      filter: data.kind === "smart" ? cookbookFilterSchema.parse(data.filter ?? {}) : null,
      coverRecipeId,
      position: (m?.m ?? -1) + 1,
      createdAt: new Date(),
    });
    return slug;
  });
  return getCookbook(db, householdId, slug, o);
}

export async function updateCookbook(
  db: Db,
  householdId: string,
  slug: string,
  patch: Partial<Omit<CookbookInput, "kind">>,
  o: ListOpts,
) {
  const row = await find(db, householdId, slug);
  const set: Partial<typeof cookbooks.$inferInsert> = {};
  if (patch.description !== undefined) set.description = patch.description || null;
  if (patch.filter !== undefined && row.kind === "smart") set.filter = cookbookFilterSchema.parse(patch.filter);
  if (patch.coverRecipe !== undefined) set.coverRecipeId = patch.coverRecipe ? await recipeBySlug(db, householdId, patch.coverRecipe) : null;
  let next = row.slug;
  await db.transaction(async (tx) => {
    if (patch.name !== undefined && patch.name !== row.name) {
      set.name = patch.name;
      set.slug = next = await freeSlug(tx, householdId, patch.name, row.id);
    }
    if (Object.keys(set).length) await tx.update(cookbooks).set(set).where(eq(cookbooks.id, row.id));
  });
  return getCookbook(db, householdId, next, o);
}

export async function deleteCookbook(db: Db, householdId: string, slug: string) {
  const row = await find(db, householdId, slug);
  await db.delete(cookbooks).where(eq(cookbooks.id, row.id));
}

export async function reorderCookbooks(db: Db, householdId: string, slugs: string[]) {
  const rows = await db.select().from(cookbooks).where(eq(cookbooks.householdId, householdId));
  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  if (slugs.some((s) => !bySlug.has(s))) throw notFound();
  const rest = rows
    .filter((r) => !slugs.includes(r.slug))
    .sort((a, b) => a.position - b.position)
    .map((r) => r.slug);
  await db.transaction(async (tx) => {
    for (const [i, s] of [...new Set([...slugs, ...rest])].entries())
      await tx.update(cookbooks).set({ position: i }).where(eq(cookbooks.id, bySlug.get(s)!));
  });
}

/** Recipes in a cookbook: a smart filter goes through the library list service; a manual list is in its saved order. */
export async function cookbookRecipesPage(
  db: Db,
  householdId: string,
  slug: string,
  q: { cursor?: string; limit: number },
  o: ListOpts,
): Promise<RecipeListResponse> {
  const row = await find(db, householdId, slug);
  if (row.kind === "smart") return smartList(db, householdId, filterOf(row), o, q);
  // Manual: the cursor is an offset into the ordered list.
  const offset = q.cursor === undefined ? 0 : Number(q.cursor);
  if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, "invalid_cursor", "Invalid cursor");
  const rows = await db
    .select({ recipeId: cookbookRecipes.recipeId })
    .from(cookbookRecipes)
    .where(eq(cookbookRecipes.cookbookId, row.id))
    .orderBy(asc(cookbookRecipes.position), asc(cookbookRecipes.recipeId))
    .limit(q.limit + 1)
    .offset(offset);
  const ids = rows.slice(0, q.limit).map((r) => r.recipeId);
  const res = ids.length ? await listRecipes(db, householdId, { sort: "updated", limit: ids.length, ids, ...o }) : { items: [], nextCursor: null };
  const order = new Map(ids.map((id, i) => [id, i]));
  res.items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { items: res.items, nextCursor: rows.length > q.limit ? String(offset + q.limit) : null };
}

export async function addToCookbook(db: Db, householdId: string, slug: string, recipeSlug: string) {
  const row = await find(db, householdId, slug);
  if (row.kind !== "manual") throw new ApiError(409, "not_manual", "Only hand-picked cookbooks hold a fixed list");
  const recipeId = await recipeBySlug(db, householdId, recipeSlug);
  await db.transaction(async (tx) => {
    const [m] = await tx.select({ m: max(cookbookRecipes.position) }).from(cookbookRecipes).where(eq(cookbookRecipes.cookbookId, row.id));
    await tx
      .insert(cookbookRecipes)
      .values({ cookbookId: row.id, recipeId, position: (m?.m ?? -1) + 1 })
      .onConflictDoNothing();
  });
}

export async function removeFromCookbook(db: Db, householdId: string, slug: string, recipeSlug: string) {
  const row = await find(db, householdId, slug);
  const recipeId = await recipeBySlug(db, householdId, recipeSlug);
  await db.delete(cookbookRecipes).where(and(eq(cookbookRecipes.cookbookId, row.id), eq(cookbookRecipes.recipeId, recipeId)));
}

/** Reorders a manual cookbook: `slugs` is the new order; recipes not listed keep their relative order at the end. */
export async function reorderCookbookRecipes(db: Db, householdId: string, slug: string, slugs: string[]) {
  const row = await find(db, householdId, slug);
  if (row.kind !== "manual") throw new ApiError(409, "not_manual", "Only hand-picked cookbooks can be reordered");
  const members = await db
    .select({ id: cookbookRecipes.recipeId, slug: recipes.slug, position: cookbookRecipes.position })
    .from(cookbookRecipes)
    .innerJoin(recipes, eq(recipes.id, cookbookRecipes.recipeId))
    .where(eq(cookbookRecipes.cookbookId, row.id));
  const bySlug = new Map(members.map((m) => [m.slug, m.id]));
  if (slugs.some((s) => !bySlug.has(s))) throw new ApiError(400, "invalid_body", "Unknown recipe in the order");
  const rest = members
    .filter((m) => !slugs.includes(m.slug))
    .sort((a, b) => a.position - b.position)
    .map((m) => m.slug);
  await db.transaction(async (tx) => {
    for (const [i, s] of [...new Set([...slugs, ...rest])].entries())
      await tx
        .update(cookbookRecipes)
        .set({ position: i })
        .where(and(eq(cookbookRecipes.cookbookId, row.id), eq(cookbookRecipes.recipeId, bySlug.get(s)!)));
  });
}

/** Slugs of the household's manual cookbooks that hold a recipe (for the "Add to cookbook" picker). */
export async function cookbooksWithRecipe(db: Db, householdId: string, recipeSlug: string): Promise<string[]> {
  const recipeId = await recipeBySlug(db, householdId, recipeSlug);
  const rows = await db
    .select({ slug: cookbooks.slug })
    .from(cookbookRecipes)
    .innerJoin(cookbooks, eq(cookbooks.id, cookbookRecipes.cookbookId))
    .where(and(eq(cookbooks.householdId, householdId), eq(cookbookRecipes.recipeId, recipeId)));
  return rows.map((r) => r.slug);
}
