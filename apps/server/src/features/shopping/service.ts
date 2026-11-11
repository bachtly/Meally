import { randomUUID } from "node:crypto";
import { foodNames } from "../foods/service.js";
import { and, asc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import {
  formatQuantity,
  guessAisle,
  mergeQuantities,
  parseIngredient,
  unitByKey,
  type AisleLabel,
  type ShoppingItem,
  type ShoppingList,
  type ShoppingRecipeRef,
} from "@meally/shared";
import type { Db } from "../../db/index.js";
import {
  aisleLabels,
  foodAisles,
  mealPlanEntries,
  recipeIngredients,
  recipes,
  shoppingItems,
  shoppingLists,
} from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import { shoppingBusFor } from "./bus.js";

const notFound = () => new ApiError(404, "not_found", "Not found");
type ItemRow = typeof shoppingItems.$inferSelect;

import { emitWebhookEvent } from "../webhooks/events.js";

export const DEFAULT_AISLES = [
  "Produce",
  "Bakery",
  "Dairy & eggs",
  "Meat & fish",
  "Pantry",
  "Spices",
  "Frozen",
  "Drinks",
  "Household",
  "Other",
];

/** Lowercase, collapse spaces, crude singular, so "Onions" and "onion" are the same food. */
export function normalizeFood(food: string): string {
  const f = food.toLowerCase().replace(/\s+/g, " ").trim();
  if (f.endsWith("ies") && f.length > 4) return `${f.slice(0, -3)}y`;
  if (f.endsWith("s") && !/(ss|us)$/.test(f) && f.length > 3)
    return f.slice(0, -1);
  return f;
}

export function itemText(
  quantity: number | null,
  unit: string | null,
  food: string | null,
  note: string | null,
  fallback: string,
): string {
  if (!food) return fallback;
  const def = unit ? unitByKey(unit) : undefined;
  const u = unit
    ? quantity != null && quantity > 1
      ? (def?.plural ?? unit)
      : (def?.names[0] ?? unit)
    : null;
  const text = [quantity != null ? formatQuantity(quantity) : null, u, food]
    .filter(Boolean)
    .join(" ");
  return note ? `${text}, ${note}` : text;
}

const toItem = (r: ItemRow): ShoppingItem => ({
  id: r.id,
  listId: r.listId,
  text: r.text,
  quantity: r.quantity,
  unit: r.unit,
  food: r.food,
  note: r.note,
  aisle: r.aisle,
  checked: r.checked,
  position: r.position,
  recipeRefs: r.recipeRefs as ShoppingRecipeRef[],
  updatedAt: r.updatedAt.toISOString(),
});

// ---- aisle labels ----

export async function listAisles(
  db: Db,
  householdId: string,
): Promise<AisleLabel[]> {
  let rows = await db
    .select()
    .from(aisleLabels)
    .where(eq(aisleLabels.householdId, householdId))
    .orderBy(asc(aisleLabels.position));
  if (rows.length === 0) {
    await db
      .insert(aisleLabels)
      .values(
        DEFAULT_AISLES.map((name, position) => ({
          id: randomUUID(),
          householdId,
          name,
          position,
          color: null,
        })),
      );
    rows = await db
      .select()
      .from(aisleLabels)
      .where(eq(aisleLabels.householdId, householdId))
      .orderBy(asc(aisleLabels.position));
  }
  return rows.map(({ id, name, position, color }) => ({
    id,
    name,
    position,
    color,
  }));
}

export async function createAisle(
  db: Db,
  householdId: string,
  input: { name: string; color: string | null },
): Promise<AisleLabel> {
  const all = await listAisles(db, householdId);
  const row = {
    id: randomUUID(),
    householdId,
    name: input.name,
    color: input.color,
    position: all.length,
  };
  await db.insert(aisleLabels).values(row);
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    color: row.color,
  };
}

async function getAisle(db: Db, householdId: string, id: string) {
  const [r] = await db
    .select()
    .from(aisleLabels)
    .where(
      and(eq(aisleLabels.id, id), eq(aisleLabels.householdId, householdId)),
    );
  if (!r) throw notFound();
  return r;
}

export async function updateAisle(
  db: Db,
  householdId: string,
  id: string,
  p: { name?: string; color?: string | null },
): Promise<AisleLabel> {
  const cur = await getAisle(db, householdId, id);
  const next = {
    name: p.name ?? cur.name,
    color: p.color === undefined ? cur.color : p.color,
  };
  await db.update(aisleLabels).set(next).where(eq(aisleLabels.id, id));
  return { id, name: next.name, color: next.color, position: cur.position };
}

export async function deleteAisle(db: Db, householdId: string, id: string) {
  await getAisle(db, householdId, id);
  await db
    .update(shoppingItems)
    .set({ aisle: null })
    .where(
      and(
        eq(shoppingItems.aisle, id),
        eq(shoppingItems.householdId, householdId),
      ),
    );
  await db
    .delete(foodAisles)
    .where(
      and(eq(foodAisles.aisleId, id), eq(foodAisles.householdId, householdId)),
    );
  await db.delete(aisleLabels).where(eq(aisleLabels.id, id));
}

export async function reorderAisles(
  db: Db,
  householdId: string,
  ids: string[],
): Promise<AisleLabel[]> {
  const all = await listAisles(db, householdId);
  const known = new Set(all.map((a) => a.id));
  if (new Set(ids).size !== ids.length || ids.some((i) => !known.has(i)))
    throw new ApiError(400, "invalid_body", "ids: unknown or repeated aisle");
  const order = [
    ...ids,
    ...all.map((a) => a.id).filter((i) => !ids.includes(i)),
  ];
  for (const [position, id] of order.entries())
    await db
      .update(aisleLabels)
      .set({ position })
      .where(eq(aisleLabels.id, id));
  return listAisles(db, householdId);
}

async function rememberedAisle(
  db: Db,
  householdId: string,
  food: string | null,
): Promise<string | null> {
  if (!food) return null;
  const [r] = await db
    .select({ a: foodAisles.aisleId })
    .from(foodAisles)
    .where(
      and(
        eq(foodAisles.householdId, householdId),
        eq(foodAisles.food, normalizeFood(food)),
      ),
    );
  if (r?.a) return r.a;
  // No remembered choice: fall back to the built-in guess, if the household still has that aisle.
  const guess = guessAisle(food);
  if (!guess) return null;
  const [g] = await db
    .select({ id: aisleLabels.id })
    .from(aisleLabels)
    .where(
      and(eq(aisleLabels.householdId, householdId), eq(aisleLabels.name, guess)),
    );
  return g?.id ?? null;
}

async function rememberAisle(
  db: Db,
  householdId: string,
  food: string,
  aisleId: string | null,
) {
  const f = normalizeFood(food);
  if (!aisleId) {
    await db
      .delete(foodAisles)
      .where(
        and(eq(foodAisles.householdId, householdId), eq(foodAisles.food, f)),
      );
    return;
  }
  await db
    .insert(foodAisles)
    .values({ householdId, food: f, aisleId })
    .onConflictDoUpdate({
      target: [foodAisles.householdId, foodAisles.food],
      set: { aisleId },
    });
}

// ---- lists ----

async function getList(db: Db, householdId: string, id: string) {
  const [r] = await db
    .select()
    .from(shoppingLists)
    .where(
      and(eq(shoppingLists.id, id), eq(shoppingLists.householdId, householdId)),
    );
  if (!r) throw notFound();
  return r;
}
export const assertList = async (db: Db, householdId: string, id: string) =>
  void (await getList(db, householdId, id));

async function counts(
  db: Db,
  householdId: string,
): Promise<Map<string, { total: number; checked: number }>> {
  const rows = await db
    .select({
      listId: shoppingItems.listId,
      total: sql<number>`count(*)::int`,
      checked: sql<number>`(count(*) filter (where ${shoppingItems.checked}))::int`,
    })
    .from(shoppingItems)
    .where(eq(shoppingItems.householdId, householdId))
    .groupBy(shoppingItems.listId);
  return new Map(
    rows.map((r) => [
      r.listId,
      { total: Number(r.total), checked: Number(r.checked) },
    ]),
  );
}

const toList = (
  r: typeof shoppingLists.$inferSelect,
  c?: { total: number; checked: number },
): ShoppingList => ({
  id: r.id,
  name: r.name,
  total: c?.total ?? 0,
  checked: c?.checked ?? 0,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function listLists(
  db: Db,
  householdId: string,
): Promise<ShoppingList[]> {
  const rows = await db
    .select()
    .from(shoppingLists)
    .where(eq(shoppingLists.householdId, householdId))
    .orderBy(asc(shoppingLists.createdAt));
  const c = await counts(db, householdId);
  return rows.map((r) => toList(r, c.get(r.id)));
}

export async function createList(
  db: Db,
  householdId: string,
  name: string,
): Promise<ShoppingList> {
  const now = new Date();
  const row = {
    id: randomUUID(),
    householdId,
    name,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(shoppingLists).values(row);
  return toList(row);
}

export async function renameList(
  db: Db,
  householdId: string,
  id: string,
  name: string,
): Promise<ShoppingList> {
  await getList(db, householdId, id);
  await db
    .update(shoppingLists)
    .set({ name, updatedAt: new Date() })
    .where(eq(shoppingLists.id, id));
  shoppingBusFor(db)?.emit(householdId, id, "list");
  return (await listLists(db, householdId)).find((l) => l.id === id)!;
}

export async function deleteList(db: Db, householdId: string, id: string) {
  await getList(db, householdId, id);
  await db.delete(shoppingItems).where(eq(shoppingItems.listId, id));
  await db.delete(shoppingLists).where(eq(shoppingLists.id, id));
  shoppingBusFor(db)?.emit(householdId, id, "deleted");
}

export async function getListWithItems(
  db: Db,
  householdId: string,
  id: string,
) {
  const l = await getList(db, householdId, id);
  const items = await loadItems(db, householdId, id);
  return {
    list: toList(l, {
      total: items.length,
      checked: items.filter((i) => i.checked).length,
    }),
    items,
  };
}

async function loadRows(db: Db, householdId: string, listId: string) {
  return db
    .select()
    .from(shoppingItems)
    .where(
      and(
        eq(shoppingItems.listId, listId),
        eq(shoppingItems.householdId, householdId),
      ),
    )
    .orderBy(asc(shoppingItems.position), asc(shoppingItems.id));
}
const loadItems = async (db: Db, householdId: string, listId: string) =>
  (await loadRows(db, householdId, listId)).map(toItem);

async function changed(db: Db, householdId: string, listId: string) {
  await db
    .update(shoppingLists)
    .set({ updatedAt: new Date() })
    .where(eq(shoppingLists.id, listId));
  shoppingBusFor(db)?.emit(householdId, listId, "items");
}

// ---- items ----

interface Incoming {
  quantity: number | null;
  unit: string | null;
  food: string | null;
  note: string | null;
  raw: string;
  ref: ShoppingRecipeRef | null;
}

/** Add ingredients to a list, merging into unchecked items with the same food and a convertible unit. */
async function addIncoming(
  db: Db,
  householdId: string,
  listId: string,
  incoming: Incoming[],
): Promise<ShoppingItem[]> {
  await listAisles(db, householdId); // seeds the defaults on first use
  const rows = await loadRows(db, householdId, listId);
  let nextPos = rows.reduce((m, r) => Math.max(m, r.position), -1) + 1;
  const touched = new Set<string>();
  const now = new Date();
  for (const inc of incoming) {
    const key = inc.food ? normalizeFood(inc.food) : null;
    let merged = false;
    if (key) {
      for (const r of rows) {
        if (r.checked || !r.food || normalizeFood(r.food) !== key) continue;
        const m = mergeQuantities(
          { quantity: r.quantity, unit: r.unit },
          { quantity: inc.quantity, unit: inc.unit },
        );
        if (!m) continue;
        const refs = r.recipeRefs as ShoppingRecipeRef[];
        if (inc.ref && !refs.some((x) => x.slug === inc.ref!.slug))
          refs.push(inc.ref);
        r.quantity = m.quantity;
        r.unit = m.unit;
        r.text = itemText(m.quantity, m.unit, r.food, r.note, r.text);
        r.recipeRefs = refs;
        r.updatedAt = now;
        touched.add(r.id);
        merged = true;
        break;
      }
    }
    if (merged) continue;
    const row: ItemRow = {
      id: randomUUID(),
      listId,
      householdId,
      text: itemText(inc.quantity, inc.unit, inc.food, inc.note, inc.raw),
      quantity: inc.quantity,
      unit: inc.unit,
      food: inc.food,
      note: inc.note,
      aisle: await rememberedAisle(db, householdId, inc.food),
      checked: false,
      position: nextPos++,
      recipeRefs: inc.ref ? [inc.ref] : [],
      updatedAt: now,
    };
    rows.push(row);
    touched.add(row.id);
    await db.insert(shoppingItems).values(row);
  }
  for (const r of rows) {
    if (!touched.has(r.id)) continue;
    await db
      .update(shoppingItems)
      .set({
        text: r.text,
        quantity: r.quantity,
        unit: r.unit,
        recipeRefs: r.recipeRefs,
        updatedAt: r.updatedAt,
      })
      .where(eq(shoppingItems.id, r.id));
  }
  await changed(db, householdId, listId);
  return rows.filter((r) => touched.has(r.id)).map(toItem);
}

export async function addFreeText(
  db: Db,
  householdId: string,
  listId: string,
  text: string,
): Promise<ShoppingItem[]> {
  await getList(db, householdId, listId);
  const p = parseIngredient(text);
  return addIncoming(db, householdId, listId, [
    {
      quantity: p.quantity,
      unit: p.unit,
      food: p.food,
      note: p.note,
      raw: text,
      ref: null,
    },
  ]);
}

async function recipeIncoming(
  db: Db,
  householdId: string,
  recipeId: string,
  factor: number | null,
  ref: ShoppingRecipeRef,
): Promise<Incoming[]> {
  const ings = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(asc(recipeIngredients.position));
  // Ingredients linked to a catalogue food use its name, so different spellings merge.
  const names = await foodNames(db, householdId, ings.flatMap((i) => (i.foodId ? [i.foodId] : [])));
  return ings.map((i) => ({
    quantity:
      i.quantity == null
        ? null
        : Math.round(i.quantity * (factor ?? 1) * 1000) / 1000,
    unit: i.unit,
    food: (i.foodId && names.get(i.foodId)) || i.food,
    note: i.note,
    raw: i.raw,
    ref,
  }));
}

export async function addRecipe(
  db: Db,
  householdId: string,
  listId: string,
  slug: string,
  servings?: number,
): Promise<ShoppingItem[]> {
  await getList(db, householdId, listId);
  const [r] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.slug, slug), eq(recipes.householdId, householdId)));
  if (!r) throw notFound();
  const factor = servings && r.servings ? servings / r.servings : null;
  return addIncoming(
    db,
    householdId,
    listId,
    await recipeIncoming(db, householdId, r.id, factor, {
      slug: r.slug,
      name: r.name,
    }),
  );
}

export async function addMealPlan(
  db: Db,
  householdId: string,
  listId: string,
  from: string,
  to: string,
): Promise<ShoppingItem[]> {
  await getList(db, householdId, listId);
  const entries = await db
    .select({ recipeId: mealPlanEntries.recipeId })
    .from(mealPlanEntries)
    .where(
      and(
        eq(mealPlanEntries.householdId, householdId),
        gte(mealPlanEntries.date, from),
        lte(mealPlanEntries.date, to),
        isNotNull(mealPlanEntries.recipeId),
      ),
    )
    .orderBy(
      asc(mealPlanEntries.date),
      asc(mealPlanEntries.mealType),
      asc(mealPlanEntries.position),
    );
  const incoming: Incoming[] = [];
  for (const e of entries) {
    const [r] = await db
      .select()
      .from(recipes)
      .where(
        and(eq(recipes.id, e.recipeId!), eq(recipes.householdId, householdId)),
      );
    if (r)
      incoming.push(
        ...(await recipeIncoming(db, householdId, r.id, null, {
          slug: r.slug,
          name: r.name,
        })),
      );
  }
  return addIncoming(db, householdId, listId, incoming);
}

async function getItem(
  db: Db,
  householdId: string,
  listId: string,
  id: string,
) {
  const [r] = await db
    .select()
    .from(shoppingItems)
    .where(
      and(
        eq(shoppingItems.id, id),
        eq(shoppingItems.listId, listId),
        eq(shoppingItems.householdId, householdId),
      ),
    );
  if (!r) throw notFound();
  return r;
}

export async function patchItem(
  db: Db,
  householdId: string,
  listId: string,
  id: string,
  p: {
    checked?: boolean;
    text?: string;
    aisle?: string | null;
    position?: number;
  },
): Promise<ShoppingItem> {
  const cur = await getItem(db, householdId, listId, id);
  const set: Partial<ItemRow> = { updatedAt: new Date() };
  if (p.checked !== undefined) set.checked = p.checked;
  if (p.position !== undefined) set.position = p.position;
  if (p.text !== undefined) {
    const parsed = parseIngredient(p.text);
    Object.assign(set, {
      text: p.text,
      quantity: parsed.quantity,
      unit: parsed.unit,
      food: parsed.food,
      note: parsed.note,
    });
  }
  if (p.aisle !== undefined) {
    if (p.aisle) await getAisle(db, householdId, p.aisle);
    set.aisle = p.aisle;
  }
  await db.update(shoppingItems).set(set).where(eq(shoppingItems.id, id));
  const food = set.food !== undefined ? set.food : cur.food;
  if (p.aisle !== undefined && food)
    await rememberAisle(db, householdId, food, p.aisle);
  await changed(db, householdId, listId);
  if (p.checked === true && !cur.checked) emitWebhookEvent(db, householdId, "shopping.item_checked", { listId, itemId: id, text: cur.text });
  return toItem(await getItem(db, householdId, listId, id));
}

export async function deleteItem(
  db: Db,
  householdId: string,
  listId: string,
  id: string,
) {
  await getItem(db, householdId, listId, id);
  await db.delete(shoppingItems).where(eq(shoppingItems.id, id));
  await changed(db, householdId, listId);
}

export async function clearChecked(
  db: Db,
  householdId: string,
  listId: string,
): Promise<number> {
  await getList(db, householdId, listId);
  const gone = await db
    .delete(shoppingItems)
    .where(
      and(
        eq(shoppingItems.listId, listId),
        eq(shoppingItems.householdId, householdId),
        eq(shoppingItems.checked, true),
      ),
    )
    .returning({ id: shoppingItems.id });
  await changed(db, householdId, listId);
  return gone.length;
}
