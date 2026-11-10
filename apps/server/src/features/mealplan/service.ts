import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { MealPlanEntry, MealPlanEntryInput, MealPlanEntryPatch, MealPlanRule, MealPlanRuleInput, MealPlanRecipeSummary, MealType } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { householdFeedTokens, mealPlanEntries, mealPlanRules, recipes } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import { imageUrl } from "../recipes/service.js";
import { loadRefs } from "../organizers/service.js";

type Row = typeof mealPlanEntries.$inferSelect;
const notFound = () => new ApiError(404, "not_found", "Not found");

export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const dayOfWeek = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

async function summaries(db: Db, householdId: string, ids: string[]): Promise<Map<string, MealPlanRecipeSummary>> {
  const out = new Map<string, MealPlanRecipeSummary>();
  if (!ids.length) return out;
  const rows = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, ids)));
  for (const r of rows) out.set(r.id, { id: r.id, name: r.name, slug: r.slug, imageUrl: imageUrl(r.imageId, 320), totalMinutes: r.totalMinutes });
  return out;
}

async function hydrate(db: Db, householdId: string, rows: Row[]): Promise<MealPlanEntry[]> {
  const map = await summaries(db, householdId, [...new Set(rows.flatMap((r) => (r.recipeId ? [r.recipeId] : [])))]);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    mealType: r.mealType as MealType,
    title: r.title,
    note: r.note,
    position: r.position,
    recipe: (r.recipeId && map.get(r.recipeId)) || null,
  }));
}

export async function listEntries(db: Db, householdId: string, from: string, to: string): Promise<MealPlanEntry[]> {
  const rows = await db
    .select()
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.householdId, householdId), gte(mealPlanEntries.date, from), lte(mealPlanEntries.date, to)))
    .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.mealType), asc(mealPlanEntries.position), asc(mealPlanEntries.createdAt));
  return hydrate(db, householdId, rows);
}

async function assertRecipe(db: Db, householdId: string, id: string) {
  const [r] = await db.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)));
  if (!r) throw new ApiError(400, "invalid_body", "recipeId: Recipe not found");
}

const slotWhere = (householdId: string, date: string, mealType: string) =>
  and(eq(mealPlanEntries.householdId, householdId), eq(mealPlanEntries.date, date), eq(mealPlanEntries.mealType, mealType));

async function nextPosition(db: Db, householdId: string, date: string, mealType: string): Promise<number> {
  const [r] = await db.select({ m: sql<number | null>`max(${mealPlanEntries.position})` }).from(mealPlanEntries).where(slotWhere(householdId, date, mealType));
  return r?.m == null ? 0 : r.m + 1;
}

export async function createEntry(db: Db, householdId: string, userId: string, input: MealPlanEntryInput): Promise<MealPlanEntry> {
  if (input.recipeId) await assertRecipe(db, householdId, input.recipeId);
  const id = randomUUID();
  await db.insert(mealPlanEntries).values({
    id,
    householdId,
    date: input.date,
    mealType: input.mealType,
    recipeId: input.recipeId ?? null,
    title: input.title ?? null,
    note: input.note ?? null,
    position: await nextPosition(db, householdId, input.date, input.mealType),
    createdBy: userId,
    createdAt: new Date(),
  });
  return getEntry(db, householdId, id);
}

export async function getEntry(db: Db, householdId: string, id: string): Promise<MealPlanEntry> {
  const [row] = await db.select().from(mealPlanEntries).where(and(eq(mealPlanEntries.id, id), eq(mealPlanEntries.householdId, householdId)));
  if (!row) throw notFound();
  return (await hydrate(db, householdId, [row]))[0]!;
}

export async function patchEntry(db: Db, householdId: string, id: string, p: MealPlanEntryPatch): Promise<MealPlanEntry> {
  const [row] = await db.select().from(mealPlanEntries).where(and(eq(mealPlanEntries.id, id), eq(mealPlanEntries.householdId, householdId)));
  if (!row) throw notFound();
  if (p.recipeId) await assertRecipe(db, householdId, p.recipeId);
  const date = p.date ?? row.date;
  const mealType = p.mealType ?? row.mealType;
  const recipeId = p.recipeId !== undefined ? p.recipeId : row.recipeId;
  const title = p.title !== undefined ? p.title : row.title;
  if (!recipeId && !title) throw new ApiError(400, "invalid_body", "title: Pick a recipe or enter a title");
  const moved = date !== row.date || mealType !== row.mealType;
  let position = row.position;
  if (p.position !== undefined) {
    // Insert at the requested index: make room by shifting the later entries in the slot.
    await db
      .update(mealPlanEntries)
      .set({ position: sql`${mealPlanEntries.position} + 1` })
      .where(and(slotWhere(householdId, date, mealType), gte(mealPlanEntries.position, p.position), sql`${mealPlanEntries.id} <> ${id}`));
    position = p.position;
  } else if (moved) {
    position = await nextPosition(db, householdId, date, mealType);
  }
  await db
    .update(mealPlanEntries)
    .set({ date, mealType, recipeId, title, note: p.note !== undefined ? p.note : row.note, position })
    .where(eq(mealPlanEntries.id, id));
  return getEntry(db, householdId, id);
}

export async function deleteEntry(db: Db, householdId: string, id: string) {
  const res = await db.delete(mealPlanEntries).where(and(eq(mealPlanEntries.id, id), eq(mealPlanEntries.householdId, householdId))).returning({ id: mealPlanEntries.id });
  if (!res.length) throw notFound();
}

// ---- rules ----

const toRule = (r: typeof mealPlanRules.$inferSelect): MealPlanRule => ({
  id: r.id,
  mealType: r.mealType as MealPlanRule["mealType"],
  dayOfWeek: r.dayOfWeek,
  tags: r.tagSlugs,
  categories: r.categorySlugs,
});

export async function listRules(db: Db, householdId: string): Promise<MealPlanRule[]> {
  const rows = await db.select().from(mealPlanRules).where(eq(mealPlanRules.householdId, householdId)).orderBy(asc(mealPlanRules.createdAt));
  return rows.map(toRule);
}

export async function createRule(db: Db, householdId: string, input: MealPlanRuleInput): Promise<MealPlanRule> {
  const id = randomUUID();
  await db.insert(mealPlanRules).values({
    id,
    householdId,
    mealType: input.mealType,
    dayOfWeek: input.dayOfWeek,
    tagSlugs: input.tags,
    categorySlugs: input.categories,
    createdAt: new Date(),
  });
  return { id, ...input };
}

export async function updateRule(db: Db, householdId: string, id: string, input: MealPlanRuleInput): Promise<MealPlanRule> {
  const res = await db
    .update(mealPlanRules)
    .set({ mealType: input.mealType, dayOfWeek: input.dayOfWeek, tagSlugs: input.tags, categorySlugs: input.categories })
    .where(and(eq(mealPlanRules.id, id), eq(mealPlanRules.householdId, householdId)))
    .returning({ id: mealPlanRules.id });
  if (!res.length) throw notFound();
  return { id, ...input };
}

export async function deleteRule(db: Db, householdId: string, id: string) {
  const res = await db.delete(mealPlanRules).where(and(eq(mealPlanRules.id, id), eq(mealPlanRules.householdId, householdId))).returning({ id: mealPlanRules.id });
  if (!res.length) throw notFound();
}

// ---- suggestion ----

export const RECENT_DAYS = 7;

/**
 * A random recipe for the slot. Rules that apply (same meal type or 'any', same weekday or any day) are alternatives:
 * a recipe qualifies if it satisfies any of them. Within a rule: any listed tag AND any listed category (an empty
 * list is no constraint). `useRules` is false when the organisers flag is off. Recipes planned in the previous
 * RECENT_DAYS days are skipped unless that would leave nothing.
 */
export async function suggest(db: Db, householdId: string, date: string, mealType: MealType, useRules: boolean, rand: () => number = Math.random): Promise<MealPlanRecipeSummary | null> {
  const all = await db.select().from(recipes).where(eq(recipes.householdId, householdId));
  if (!all.length) return null;
  const dow = dayOfWeek(date);
  const rules = useRules ? (await listRules(db, householdId)).filter((r) => (r.mealType === "any" || r.mealType === mealType) && (r.dayOfWeek === null || r.dayOfWeek === dow)) : [];
  let pool = all;
  if (rules.length) {
    const ids = all.map((r) => r.id);
    const tagMap = await loadRefs(db, "tags", ids);
    const catMap = await loadRefs(db, "categories", ids);
    pool = all.filter((r) => {
      const t = (tagMap.get(r.id) ?? []).map((x) => x.slug);
      const c = (catMap.get(r.id) ?? []).map((x) => x.slug);
      return rules.some((rule) => (!rule.tags.length || rule.tags.some((s) => t.includes(s))) && (!rule.categories.length || rule.categories.some((s) => c.includes(s))));
    });
  }
  if (!pool.length) return null;
  const recent = await db
    .select({ recipeId: mealPlanEntries.recipeId })
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.householdId, householdId), gte(mealPlanEntries.date, addDays(date, -RECENT_DAYS)), lte(mealPlanEntries.date, addDays(date, -1))));
  const seen = new Set(recent.map((r) => r.recipeId));
  const fresh = pool.filter((r) => !seen.has(r.id));
  const from = fresh.length ? fresh : pool;
  const pick = from[Math.floor(rand() * from.length)]!;
  return { id: pick.id, name: pick.name, slug: pick.slug, imageUrl: imageUrl(pick.imageId, 320), totalMinutes: pick.totalMinutes };
}

// ---- feed token ----

export async function getFeedToken(db: Db, householdId: string): Promise<string> {
  const [row] = await db.select().from(householdFeedTokens).where(eq(householdFeedTokens.householdId, householdId));
  return row?.token ?? rotateFeedToken(db, householdId);
}

export async function rotateFeedToken(db: Db, householdId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db
    .insert(householdFeedTokens)
    .values({ householdId, token, createdAt: new Date() })
    .onConflictDoUpdate({ target: householdFeedTokens.householdId, set: { token, createdAt: new Date() } });
  return token;
}

export async function householdForToken(db: Db, token: string): Promise<string | null> {
  const [row] = await db.select().from(householdFeedTokens).where(eq(householdFeedTokens.token, token));
  return row?.householdId ?? null;
}
