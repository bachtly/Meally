import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import type { ImageSize, Recipe, RecipeData, RecipeListResponse, RecipeSummary } from "@meally/shared";
import { imageSizes } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { images, recipeIngredients, recipes, recipeSteps, recipeUserData, timelineEvents } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import { getMe, householdRating } from "../ratings/service.js";
import { hasAnyOf, loadRefs, setRecipeOrganizers } from "../organizers/service.js";

/** `org` is true when the organizers flag is on; when off, organiser fields are ignored and omitted. */
type Org = { org?: boolean; userId?: string; ratings?: boolean; timeline?: boolean };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = typeof recipes.$inferSelect;

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

/** The search index is written here, in the same transaction as the recipe, rather than by triggers. */
async function reindex(tx: Tx, householdId: string, id: string, data: RecipeData) {
  await tx.run(sql`DELETE FROM recipes_fts WHERE recipe_id = ${id}`);
  const ingredients = data.ingredients.map((i) => [i.raw, i.food].filter(Boolean).join(" ")).join("\n");
  await tx.run(
    sql`INSERT INTO recipes_fts (recipe_id, household_id, name, description, ingredients)
        VALUES (${id}, ${householdId}, ${data.name}, ${data.description ?? ""}, ${ingredients})`,
  );
}

async function writeChildren(tx: Tx, id: string, data: RecipeData) {
  await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
  await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, id));
  if (data.ingredients.length)
    await tx.insert(recipeIngredients).values(data.ingredients.map((i, position) => ({ ...i, recipeId: id, position })));
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
      .values({ id, householdId, slug, ...fields(data), createdBy: userId, createdAt: now, updatedAt: now })
      .returning();
    await writeChildren(tx, id, data);
    if (o.org) await writeOrganizers(tx, householdId, id, data);
    await reindex(tx, householdId, id, data);
    return row!;
  });
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
      .set({ ...fields(data), updatedAt: new Date() })
      .where(and(eq(recipes.id, existing.id), eq(recipes.householdId, householdId)))
      .returning();
    await writeChildren(tx, existing.id, data);
    if (o.org) await writeOrganizers(tx, householdId, existing.id, data);
    await reindex(tx, householdId, existing.id, data);
    return row!;
  });
  return load(db, row, o);
}

export async function deleteRecipe(db: Db, dataDir: string, householdId: string, slug: string) {
  const extra: string[] = [];
  const imageId = await db.transaction(async (tx) => {
    const existing = await findRow(tx, householdId, slug);
    const tlImgs = (await tx.select({ id: timelineEvents.imageId }).from(timelineEvents).where(eq(timelineEvents.recipeId, existing.id)))
      .map((r) => r.id)
      .filter((x): x is string => !!x);
    extra.push(...tlImgs);
    await tx.run(sql`DELETE FROM recipes_fts WHERE recipe_id = ${existing.id}`);
    await tx.delete(recipes).where(and(eq(recipes.id, existing.id), eq(recipes.householdId, householdId)));
    if (existing.imageId) await tx.delete(images).where(eq(images.id, existing.imageId));
    if (tlImgs.length) await tx.delete(images).where(inArray(images.id, tlImgs));
    return existing.imageId;
  });
  if (imageId) await removeImageFiles(dataDir, householdId, imageId);
  for (const id of extra) await removeImageFiles(dataDir, householdId, id);
}

/** Turns free text into an FTS5 prefix query: every word must match as a prefix. */
export function ftsQuery(q: string): string | null {
  const words = q.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : null;
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
    const match = ftsQuery(opts.q);
    if (match === null) return { items: [], nextCursor: null };
    conds.push(
      sql`${recipes.id} IN (SELECT recipe_id FROM recipes_fts WHERE recipes_fts MATCH ${match} AND household_id = ${householdId})`,
    );
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
  const lastMadeSql = sql`(SELECT max(created_at) FROM timeline_events te WHERE te.recipe_id = ${recipes.id} AND te.kind = 'made')`;
  const madeCountSql = sql`(SELECT count(*) FROM timeline_events te WHERE te.recipe_id = ${recipes.id} AND te.kind = 'made')`;
  const key =
    sort === "last-made" && tl
      ? sql`coalesce(${lastMadeSql}, 0)`
      : sort === "name"
      ? sql`lower(${recipes.name})`
      : sort === "created"
        ? recipes.createdAt
        : sort === "rating"
          ? sql`coalesce(${recipeUserData.rating}, 0)`
          : recipes.updatedAt;
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

const imageDir = (dataDir: string, householdId: string) => path.join(dataDir, "images", householdId);
export const imagePath = (dataDir: string, householdId: string, id: string, size: ImageSize) =>
  path.join(imageDir(dataDir, householdId), `${id}-${size}.webp`);

export async function removeImageFiles(dataDir: string, householdId: string, id: string) {
  await Promise.all(imageSizes.map((s) => fs.rm(imagePath(dataDir, householdId, id, s), { force: true })));
}

/** Resizes to WebP at every size and stores the files; returns the new image id. The caller records the row. */
export async function processImage(dataDir: string, householdId: string, input: Buffer): Promise<string> {
  const { default: sharp } = await import("sharp");
  const id = randomUUID();
  await fs.mkdir(imageDir(dataDir, householdId), { recursive: true });
  try {
    await Promise.all(
      imageSizes.map(async (size) => {
        const out = await sharp(input, { limitInputPixels: 100_000_000 })
          .rotate()
          .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        await fs.writeFile(imagePath(dataDir, householdId, id, size), out);
      }),
    );
  } catch (e) {
    await removeImageFiles(dataDir, householdId, id);
    throw e;
  }
  return id;
}

/** Stores a new image and points the recipe at it. */
export async function setRecipeImage(db: Db, dataDir: string, householdId: string, slug: string, input: Buffer): Promise<string> {
  const row = await findRow(db, householdId, slug);
  const id = await processImage(dataDir, householdId, input);
  await db.transaction(async (tx) => {
    await tx.insert(images).values({ id, householdId, createdAt: new Date() });
    await tx
      .update(recipes)
      .set({ imageId: id, updatedAt: new Date() })
      .where(and(eq(recipes.id, row.id), eq(recipes.householdId, householdId)));
    if (row.imageId) await tx.delete(images).where(eq(images.id, row.imageId));
  });
  if (row.imageId) await removeImageFiles(dataDir, householdId, row.imageId);
  return id;
}

export async function findImage(db: Db, householdId: string, id: string) {
  const [img] = await db.select().from(images).where(and(eq(images.id, id), eq(images.householdId, householdId))).limit(1);
  return img ?? null;
}
