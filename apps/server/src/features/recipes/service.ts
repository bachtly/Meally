import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import type { ImageSize, Recipe, RecipeData, RecipeListResponse, RecipeSummary } from "@meally/shared";
import { imageSizes } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { images, recipeIngredients, recipes, recipeSteps } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";

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

async function load(db: Pick<Db, "select">, row: Row): Promise<Recipe> {
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
  };
}

async function findRow(db: Pick<Db, "select">, householdId: string, slug: string): Promise<Row> {
  const [row] = await db.select().from(recipes).where(and(eq(recipes.householdId, householdId), eq(recipes.slug, slug))).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Recipe not found");
  return row;
}

export async function createRecipe(db: Db, householdId: string, userId: string, data: RecipeData): Promise<Recipe> {
  const now = new Date();
  const id = randomUUID();
  const row = await db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, householdId, data.name);
    const [row] = await tx
      .insert(recipes)
      .values({ id, householdId, slug, ...fields(data), createdBy: userId, createdAt: now, updatedAt: now })
      .returning();
    await writeChildren(tx, id, data);
    await reindex(tx, householdId, id, data);
    return row!;
  });
  return load(db, row);
}

export async function getRecipe(db: Db, householdId: string, slug: string): Promise<Recipe> {
  return load(db, await findRow(db, householdId, slug));
}

/** Replaces the recipe fields, ingredients and steps in one transaction. The slug never changes. */
export async function replaceRecipe(db: Db, householdId: string, slug: string, data: RecipeData): Promise<Recipe> {
  const row = await db.transaction(async (tx) => {
    const existing = await findRow(tx, householdId, slug);
    const [row] = await tx
      .update(recipes)
      .set({ ...fields(data), updatedAt: new Date() })
      .where(and(eq(recipes.id, existing.id), eq(recipes.householdId, householdId)))
      .returning();
    await writeChildren(tx, existing.id, data);
    await reindex(tx, householdId, existing.id, data);
    return row!;
  });
  return load(db, row);
}

export async function deleteRecipe(db: Db, dataDir: string, householdId: string, slug: string) {
  const imageId = await db.transaction(async (tx) => {
    const existing = await findRow(tx, householdId, slug);
    await tx.run(sql`DELETE FROM recipes_fts WHERE recipe_id = ${existing.id}`);
    await tx.delete(recipes).where(and(eq(recipes.id, existing.id), eq(recipes.householdId, householdId)));
    if (existing.imageId) await tx.delete(images).where(eq(images.id, existing.imageId));
    return existing.imageId;
  });
  if (imageId) await removeImageFiles(dataDir, householdId, imageId);
}

/** Turns free text into an FTS5 prefix query: every word must match as a prefix. */
export function ftsQuery(q: string): string | null {
  const words = q.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : null;
}

const encode = (v: string | number, id: string) => Buffer.from(JSON.stringify([v, id])).toString("base64url");
function decode(cursor: string): [string | number, string] {
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
  opts: { q?: string; sort: "updated" | "name" | "created"; cursor?: string; limit: number },
): Promise<RecipeListResponse> {
  const conds: SQL[] = [eq(recipes.householdId, householdId)];
  if (opts.q) {
    const match = ftsQuery(opts.q);
    if (match === null) return { items: [], nextCursor: null };
    conds.push(
      sql`${recipes.id} IN (SELECT recipe_id FROM recipes_fts WHERE recipes_fts MATCH ${match} AND household_id = ${householdId})`,
    );
  }
  // Keyset pagination on (sort key, id). updated/created are newest first; name is A to Z.
  const key = opts.sort === "name" ? sql`lower(${recipes.name})` : opts.sort === "created" ? recipes.createdAt : recipes.updatedAt;
  const ascending = opts.sort === "name";
  if (opts.cursor) {
    const [v, id] = decode(opts.cursor);
    const op = ascending ? sql`>` : sql`<`;
    conds.push(sql`(${key} ${op} ${v} OR (${key} = ${v} AND ${recipes.id} ${op} ${id}))`);
  }
  const dir = ascending ? asc : desc;
  const rows = await db
    .select({ row: recipes, k: sql<string | number>`${key}`.as("k") })
    .from(recipes)
    .where(and(...conds))
    .orderBy(dir(key), dir(recipes.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  const items: RecipeSummary[] = page.map(({ row }) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    imageUrl: imageUrl(row.imageId, 320),
    totalMinutes: row.totalMinutes,
    servings: row.servings,
    updatedAt: row.updatedAt.getTime(),
  }));
  return { items, nextCursor: rows.length > opts.limit && last ? encode(last.k, last.row.id) : null };
}

// ---- images ----

const imageDir = (dataDir: string, householdId: string) => path.join(dataDir, "images", householdId);
export const imagePath = (dataDir: string, householdId: string, id: string, size: ImageSize) =>
  path.join(imageDir(dataDir, householdId), `${id}-${size}.webp`);

async function removeImageFiles(dataDir: string, householdId: string, id: string) {
  await Promise.all(imageSizes.map((s) => fs.rm(imagePath(dataDir, householdId, id, s), { force: true })));
}

/** Resizes to WebP at every size, stores the files, and points the recipe at the new image. */
export async function setRecipeImage(db: Db, dataDir: string, householdId: string, slug: string, input: Buffer): Promise<string> {
  const { default: sharp } = await import("sharp");
  const row = await findRow(db, householdId, slug);
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
