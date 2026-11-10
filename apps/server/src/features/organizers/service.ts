import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { OrganizerRef, OrganizerType } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { categories, recipeCategories, recipeTags, recipeTools, tags, tools } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Q = Pick<Db, "select">;

const KINDS = {
  tags: { table: tags, link: recipeTags, col: "tagId" as const, sqlCol: "tag_id", label: "Tag" },
  categories: { table: categories, link: recipeCategories, col: "categoryId" as const, sqlCol: "category_id", label: "Category" },
  tools: { table: tools, link: recipeTools, col: "toolId" as const, sqlCol: "tool_id", label: "Tool" },
};
// The three kinds have the same shape; one loosely typed view keeps the generic code short.
const kind = (t: OrganizerType) => KINDS[t] as unknown as {
  table: typeof tags;
  link: typeof recipeTags;
  col: "tagId";
  sqlCol: string;
  label: string;
};

export function organizerSlug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return s || "item";
}

/** Trims, collapses spaces, drops blanks and case-insensitive duplicates (first spelling wins). */
export function cleanNames(names: readonly string[], max = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim().replace(/\s+/g, " ").slice(0, 60);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.slice(0, max);
}

async function freeSlug(tx: Tx, type: OrganizerType, householdId: string, name: string, ignoreId?: string) {
  const { table } = kind(type);
  const rows = await tx.select({ id: table.id, slug: table.slug }).from(table).where(eq(table.householdId, householdId));
  const taken = new Set(rows.filter((r) => r.id !== ignoreId).map((r) => r.slug));
  const base = organizerSlug(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Finds an item by name (case-insensitive) or creates it. */
async function upsertByName(tx: Tx, type: OrganizerType, householdId: string, name: string): Promise<string> {
  const { table } = kind(type);
  const [hit] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.householdId, householdId), sql`lower(${table.name}) = ${name.toLowerCase()}`))
    .limit(1);
  if (hit) return hit.id;
  const id = randomUUID();
  await tx.insert(table).values({ id, householdId, name, slug: await freeSlug(tx, type, householdId, name) });
  return id;
}

/** Replaces a recipe's items of one type with the named ones. */
export async function setRecipeOrganizers(
  tx: Tx,
  type: OrganizerType,
  householdId: string,
  recipeId: string,
  names: readonly string[],
) {
  const { link, col } = kind(type);
  await tx.delete(link).where(eq(link.recipeId, recipeId));
  const ids: string[] = [];
  for (const n of cleanNames(names)) ids.push(await upsertByName(tx, type, householdId, n));
  if (ids.length) await tx.insert(link).values(ids.map((id) => ({ recipeId, [col]: id })));
}

/** Loads refs for many recipes at once: recipeId to refs, sorted by name. */
export async function loadRefs(db: Q, type: OrganizerType, recipeIds: string[]): Promise<Map<string, OrganizerRef[]>> {
  const out = new Map<string, OrganizerRef[]>();
  if (!recipeIds.length) return out;
  const { table, link, col } = kind(type);
  const rows = await db
    .select({ recipeId: link.recipeId, name: table.name, slug: table.slug })
    .from(link)
    .innerJoin(table, eq(table.id, link[col]))
    .where(inArray(link.recipeId, recipeIds))
    .orderBy(asc(sql`lower(${table.name})`));
  for (const r of rows) {
    const list = out.get(r.recipeId) ?? [];
    list.push({ name: r.name, slug: r.slug });
    out.set(r.recipeId, list);
  }
  return out;
}

/** SQL condition: the recipe has at least one item of this type whose slug is in `slugs`. */
export function hasAnyOf(type: OrganizerType, householdId: string, slugs: string[], recipeIdCol: unknown): SQL {
  const { table, link, col } = kind(type);
  return sql`${recipeIdCol} IN (SELECT ${link.recipeId} FROM ${link} INNER JOIN ${table} ON ${table.id} = ${link[col]}
    WHERE ${table.householdId} = ${householdId} AND ${inArray(table.slug, slugs)})`;
}

// ---- management ----

export async function listOrganizers(db: Db, type: OrganizerType, householdId: string) {
  const { table, link, col } = kind(type);
  const rows = await db
    .select({ name: table.name, slug: table.slug, count: sql<number>`count(${link.recipeId})` })
    .from(table)
    .leftJoin(link, eq(link[col], table.id))
    .where(eq(table.householdId, householdId))
    .groupBy(table.id)
    .orderBy(asc(sql`lower(${table.name})`));
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

async function find(db: Q, type: OrganizerType, householdId: string, slug: string) {
  const { table, label } = kind(type);
  const [row] = await db.select().from(table).where(and(eq(table.householdId, householdId), eq(table.slug, slug))).limit(1);
  if (!row) throw new ApiError(404, "not_found", `${label} not found`);
  return row;
}

async function nameTaken(tx: Q, type: OrganizerType, householdId: string, name: string, exceptId?: string) {
  const { table } = kind(type);
  const rows = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.householdId, householdId), sql`lower(${table.name}) = ${name.toLowerCase()}`));
  return rows.some((r) => r.id !== exceptId);
}

function requireName(raw: string): string {
  const name = cleanNames([raw])[0];
  if (!name) throw new ApiError(400, "invalid_body", "name: Name is required");
  return name;
}

export async function createOrganizer(db: Db, type: OrganizerType, householdId: string, rawName: string) {
  const name = requireName(rawName);
  const { table, label } = kind(type);
  return db.transaction(async (tx) => {
    if (await nameTaken(tx, type, householdId, name)) throw new ApiError(409, "conflict", `${label} already exists`);
    const slug = await freeSlug(tx, type, householdId, name);
    await tx.insert(table).values({ id: randomUUID(), householdId, name, slug });
    return { name, slug, count: 0 };
  });
}

/** Renames. The slug follows the name (unless it would collide), so links by slug change with it. */
export async function renameOrganizer(db: Db, type: OrganizerType, householdId: string, slug: string, rawName: string) {
  const name = requireName(rawName);
  const { table, link, col, label } = kind(type);
  return db.transaction(async (tx) => {
    const row = await find(tx, type, householdId, slug);
    if (await nameTaken(tx, type, householdId, name, row.id)) throw new ApiError(409, "conflict", `${label} already exists`);
    const next = await freeSlug(tx, type, householdId, name, row.id);
    await tx.update(table).set({ name, slug: next }).where(and(eq(table.id, row.id), eq(table.householdId, householdId)));
    const [c] = await tx.select({ n: sql<number>`count(*)` }).from(link).where(eq(link[col], row.id));
    return { name, slug: next, count: Number(c?.n ?? 0) };
  });
}

export async function deleteOrganizer(db: Db, type: OrganizerType, householdId: string, slug: string) {
  const { table } = kind(type);
  await db.transaction(async (tx) => {
    const row = await find(tx, type, householdId, slug);
    await tx.delete(table).where(and(eq(table.id, row.id), eq(table.householdId, householdId)));
  });
}

/** Moves every recipe from `slug` to `into`, then removes `slug`. A recipe that has both keeps one link. */
export async function mergeOrganizers(db: Db, type: OrganizerType, householdId: string, slug: string, into: string) {
  if (slug === into) throw new ApiError(400, "invalid_body", "Choose a different item to merge into");
  const { table, link, col, sqlCol } = kind(type);
  await db.transaction(async (tx) => {
    const from = await find(tx, type, householdId, slug);
    const to = await find(tx, type, householdId, into);
    await tx.run(
      sql`INSERT OR IGNORE INTO ${link} (recipe_id, ${sql.raw(sqlCol)})
          SELECT recipe_id, ${to.id} FROM ${link} WHERE ${link[col]} = ${from.id}`,
    );
    await tx.delete(table).where(and(eq(table.id, from.id), eq(table.householdId, householdId)));
  });
  return (await listOrganizers(db, type, householdId)).find((o) => o.slug === into)!;
}
