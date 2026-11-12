import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { UNITS, type Food, type ParseVocab, type UnitItem } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { aisleLabels, customUnits, foods, recipeIngredients, recipes } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Q = Pick<Db, "select" | "update" | "insert" | "delete">;
type FoodRow = typeof foods.$inferSelect;
type UnitRow = typeof customUnits.$inferSelect;

const lc = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const notFound = () => new ApiError(404, "not_found", "Not found");

/** Every spelling a food answers to, lowercased. */
export const spellings = (f: Pick<FoodRow, "name" | "pluralName" | "aliases">) =>
  [f.name, f.pluralName ?? "", ...f.aliases].map(lc).filter(Boolean);

export function matchFood(list: FoodRow[], text: string): FoodRow | undefined {
  const t = lc(text);
  return list.find((f) => spellings(f).includes(t));
}

export const userFoods = (db: Pick<Db, "select">, userId: string) =>
  db.select().from(foods).where(eq(foods.userId, userId));

/** Links each ingredient's food to a food, creating missing ones. Returns food ids by index. */
export async function linkFoods(tx: Tx, userId: string, names: Array<string | null>): Promise<Array<string | null>> {
  const list = await userFoods(tx, userId);
  const out: Array<string | null> = [];
  for (const n of names) {
    const text = n ? clean(n) : "";
    if (!text) {
      out.push(null);
      continue;
    }
    let f = matchFood(list, text);
    if (!f) {
      f = { id: randomUUID(), userId, name: text, pluralName: null, aliases: [], aisleId: null, createdAt: new Date() };
      await tx.insert(foods).values(f);
      list.push(f);
    }
    out.push(f.id);
  }
  return out;
}

export async function parseVocab(db: Db, userId: string): Promise<ParseVocab> {
  const [fs, us] = await Promise.all([
    userFoods(db, userId),
    db.select().from(customUnits).where(eq(customUnits.userId, userId)),
  ]);
  return {
    foods: fs.map((f) => ({ name: f.name, plural: f.pluralName, aliases: f.aliases })),
    units: us.map((u) => ({ key: u.key, names: [u.name, u.plural, u.abbreviation ?? ""].filter(Boolean) })),
  };
}

async function usage(db: Pick<Db, "select">, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: recipeIngredients.foodId, n: sql<number>`count(distinct ${recipeIngredients.recipeId})` })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(and(eq(recipes.userId, userId), sql`${recipeIngredients.foodId} is not null`))
    .groupBy(recipeIngredients.foodId);
  return new Map(rows.map((r) => [r.id!, Number(r.n)]));
}

const toFood = (f: FoodRow, count: number): Food => ({
  id: f.id,
  name: f.name,
  pluralName: f.pluralName,
  aliases: f.aliases,
  aisleId: f.aisleId,
  count,
});

export async function listFoods(db: Db, userId: string, q?: string): Promise<Food[]> {
  const [rows, counts] = await Promise.all([userFoods(db, userId), usage(db, userId)]);
  const needle = q ? lc(q) : "";
  return rows
    .filter((f) => !needle || spellings(f).some((s) => s.includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => toFood(f, counts.get(f.id) ?? 0));
}

async function get(db: Q, userId: string, id: string): Promise<FoodRow> {
  const [row] = await db.select().from(foods).where(and(eq(foods.id, id), eq(foods.userId, userId)));
  if (!row) throw notFound();
  return row;
}

async function checkAisle(db: Q, userId: string, aisleId: string | null | undefined) {
  if (!aisleId) return;
  const [a] = await db
    .select({ id: aisleLabels.id })
    .from(aisleLabels)
    .where(and(eq(aisleLabels.id, aisleId), eq(aisleLabels.userId, userId)));
  if (!a) throw new ApiError(400, "invalid_body", "aisleId: unknown aisle");
}

/** Throws 409 when any spelling in `next` already belongs to a different food. */
function assertFree(list: FoodRow[], selfId: string | null, next: Pick<FoodRow, "name" | "pluralName" | "aliases">) {
  const own = spellings(next);
  if (new Set(own).size !== own.length) throw new ApiError(400, "invalid_body", "Name, plural and aliases must all differ");
  for (const f of list) {
    if (f.id === selfId) continue;
    const hit = spellings(f).find((s) => own.includes(s));
    if (hit) throw new ApiError(409, "conflict", `"${hit}" already belongs to the food "${f.name}"`);
  }
}

const uniq = (xs: string[]) => [...new Map(xs.map((x) => [lc(x), clean(x)])).values()];

export async function createFood(
  db: Db,
  userId: string,
  input: { name: string; pluralName: string | null; aliases?: string[] | undefined; aisleId?: string | null | undefined },
): Promise<Food> {
  await checkAisle(db, userId, input.aisleId);
  const row: FoodRow = {
    id: randomUUID(),
    userId,
    name: clean(input.name),
    pluralName: input.pluralName ? clean(input.pluralName) : null,
    aliases: uniq(input.aliases ?? []),
    aisleId: input.aisleId ?? null,
    createdAt: new Date(),
  };
  assertFree(await userFoods(db, userId), null, row);
  await db.insert(foods).values(row);
  return toFood(row, 0);
}

export async function updateFood(
  db: Db,
  userId: string,
  id: string,
  patch: { name?: string | undefined; pluralName?: string | null | undefined; aliases?: string[] | undefined; aisleId?: string | null | undefined },
): Promise<Food> {
  return db.transaction(async (tx) => {
    const cur = await get(tx, userId, id);
    if (patch.aisleId !== undefined) await checkAisle(tx, userId, patch.aisleId);
    const next: FoodRow = {
      ...cur,
      ...(patch.name !== undefined ? { name: clean(patch.name) } : {}),
      ...(patch.pluralName !== undefined ? { pluralName: patch.pluralName ? clean(patch.pluralName) : null } : {}),
      ...(patch.aliases !== undefined ? { aliases: uniq(patch.aliases) } : {}),
      ...(patch.aisleId !== undefined ? { aisleId: patch.aisleId } : {}),
    };
    assertFree(await userFoods(tx, userId), id, next);
    await tx
      .update(foods)
      .set({ name: next.name, pluralName: next.pluralName, aliases: next.aliases, aisleId: next.aisleId })
      .where(eq(foods.id, id));
    // Linked ingredients show the catalogue name.
    if (next.name !== cur.name) await tx.update(recipeIngredients).set({ food: next.name }).where(eq(recipeIngredients.foodId, id));
    return toFood(next, (await usage(tx, userId)).get(id) ?? 0);
  });
}

export async function deleteFood(db: Db, userId: string, id: string, force: boolean) {
  await db.transaction(async (tx) => {
    await get(tx, userId, id);
    const n = (await usage(tx, userId)).get(id) ?? 0;
    if (n > 0 && !force) throw new ApiError(409, "in_use", `Used by ${n} recipe${n === 1 ? "" : "s"}; pass ?force=1 to unlink it`);
    await tx.update(recipeIngredients).set({ foodId: null }).where(eq(recipeIngredients.foodId, id));
    await tx.delete(foods).where(eq(foods.id, id));
  });
}

/** Moves every ingredient and every spelling of `id` onto `into`, then deletes `id`. */
export async function mergeFood(db: Db, userId: string, id: string, intoId: string): Promise<Food> {
  if (id === intoId) throw new ApiError(400, "invalid_body", "Choose a different food to merge into");
  return db.transaction(async (tx) => {
    const from = await get(tx, userId, id);
    const into = await get(tx, userId, intoId);
    const own = spellings({ name: into.name, pluralName: into.pluralName, aliases: [] });
    const aliases = uniq([...into.aliases, from.name, ...(from.pluralName ? [from.pluralName] : []), ...from.aliases]).filter(
      (a) => !own.includes(lc(a)),
    );
    const aisleId = into.aisleId ?? from.aisleId;
    await tx.update(recipeIngredients).set({ foodId: intoId, food: into.name }).where(eq(recipeIngredients.foodId, id));
    await tx.delete(foods).where(eq(foods.id, id));
    await tx.update(foods).set({ aliases, aisleId }).where(eq(foods.id, intoId));
    return toFood({ ...into, aliases, aisleId }, (await usage(tx, userId)).get(intoId) ?? 0);
  });
}

// ---- units ----

export function unitKey(name: string): string {
  return (
    "c-" +
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

const toUnit = (u: UnitRow, count: number): UnitItem => ({
  key: u.key,
  name: u.name,
  plural: u.plural,
  abbreviation: u.abbreviation,
  kind: u.kind as UnitItem["kind"],
  factor: u.factor,
  builtIn: false,
  id: u.id,
  count,
});

async function unitUsage(db: Pick<Db, "select">, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ unit: recipeIngredients.unit, n: sql<number>`count(distinct ${recipeIngredients.recipeId})` })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(and(eq(recipes.userId, userId), sql`${recipeIngredients.unit} is not null`))
    .groupBy(recipeIngredients.unit);
  return new Map(rows.map((r) => [r.unit!, Number(r.n)]));
}

export async function listUnits(db: Db, userId: string): Promise<UnitItem[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(customUnits).where(eq(customUnits.userId, userId)),
    unitUsage(db, userId),
  ]);
  const builtIn: UnitItem[] = UNITS.map((u) => ({
    key: u.key,
    name: u.names[0]!,
    plural: u.plural,
    abbreviation: null,
    kind: u.kind,
    factor: u.kind === "count" ? null : u.factor,
    builtIn: true,
    count: counts.get(u.key) ?? 0,
  }));
  const custom = rows.sort((a, b) => a.name.localeCompare(b.name)).map((u) => toUnit(u, counts.get(u.key) ?? 0));
  return [...custom, ...builtIn];
}

type UnitInput = {
  name?: string | undefined;
  plural?: string | null | undefined;
  abbreviation?: string | null | undefined;
  kind?: "mass" | "volume" | "count" | undefined;
  factor?: number | null | undefined;
};

async function assertUnitFree(db: Q, userId: string, selfId: string | null, names: string[]) {
  const taken = new Set(UNITS.flatMap((u) => [u.key, ...u.names, u.plural].map(lc)));
  const mine = (await db.select().from(customUnits).where(eq(customUnits.userId, userId))).filter((u) => u.id !== selfId);
  for (const u of mine) for (const n of [u.key, u.name, u.plural, u.abbreviation ?? ""]) if (n) taken.add(lc(n));
  const clash = names.map(lc).find((n) => n && taken.has(n));
  if (clash) throw new ApiError(409, "conflict", `"${clash}" is already a unit`);
}

export async function createUnit(db: Db, userId: string, input: UnitInput & { name: string }): Promise<UnitItem> {
  const name = clean(input.name);
  const key = unitKey(name);
  if (key === "c-") throw new ApiError(400, "invalid_body", "name: use letters or digits");
  const kind = input.kind ?? "count";
  const row: UnitRow = {
    id: randomUUID(),
    userId,
    key,
    name,
    plural: input.plural ? clean(input.plural) : name,
    abbreviation: input.abbreviation ? clean(input.abbreviation) : null,
    kind,
    factor: kind === "count" ? null : (input.factor ?? null),
  };
  await assertUnitFree(db, userId, null, [key, row.name, row.plural, row.abbreviation ?? ""]);
  await db.insert(customUnits).values(row);
  return toUnit(row, 0);
}

async function getUnit(db: Q, userId: string, id: string): Promise<UnitRow> {
  const [u] = await db
    .select()
    .from(customUnits)
    .where(and(eq(customUnits.id, id), eq(customUnits.userId, userId)));
  if (!u) throw notFound();
  return u;
}

/** The key never changes on rename, so recipes keep working. */
export async function updateUnit(db: Db, userId: string, id: string, patch: UnitInput): Promise<UnitItem> {
  const cur = await getUnit(db, userId, id);
  const kind = patch.kind ?? (cur.kind as "mass" | "volume" | "count");
  const name = patch.name !== undefined ? clean(patch.name) : cur.name;
  const next: UnitRow = {
    ...cur,
    name,
    plural: patch.plural !== undefined ? (patch.plural ? clean(patch.plural) : name) : cur.plural,
    abbreviation: patch.abbreviation !== undefined ? (patch.abbreviation ? clean(patch.abbreviation) : null) : cur.abbreviation,
    kind,
    factor: kind === "count" ? null : patch.factor !== undefined ? patch.factor : cur.factor,
  };
  await assertUnitFree(db, userId, id, [next.name, next.plural, next.abbreviation ?? ""]);
  await db
    .update(customUnits)
    .set({ name: next.name, plural: next.plural, abbreviation: next.abbreviation, kind: next.kind, factor: next.factor })
    .where(eq(customUnits.id, id));
  return toUnit(next, (await unitUsage(db, userId)).get(cur.key) ?? 0);
}

export async function deleteUnit(db: Db, userId: string, id: string, force: boolean) {
  await db.transaction(async (tx) => {
    const cur = await getUnit(tx, userId, id);
    const n = (await unitUsage(tx, userId)).get(cur.key) ?? 0;
    if (n > 0 && !force) throw new ApiError(409, "in_use", `Used by ${n} recipe${n === 1 ? "" : "s"}; pass ?force=1 to unlink it`);
    if (n > 0) {
      // The ingredient keeps its text and raw line; only the structured unit goes.
      const mine = tx.select({ id: recipes.id }).from(recipes).where(eq(recipes.userId, userId));
      await tx
        .update(recipeIngredients)
        .set({ unit: null })
        .where(and(eq(recipeIngredients.unit, cur.key), sql`${recipeIngredients.recipeId} in ${mine}`));
    }
    await tx.delete(customUnits).where(eq(customUnits.id, id));
  });
}

/** Names for food ids, used by the shopping list so linked foods merge whatever their spelling. */
export async function foodNames(db: Pick<Db, "select">, userId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const want = new Set(ids);
  return new Map((await userFoods(db, userId)).filter((r) => want.has(r.id)).map((r) => [r.id, r.name]));
}
