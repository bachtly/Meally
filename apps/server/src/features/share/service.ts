import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  cookbookFilterSchema,
  SHARE_COOKBOOK_MAX,
  type CreateShare,
  type CreateShareSet,
  type PublicRecipe,
  type PublicShare,
  type PublicShareItem,
  type ShareLink,
  type ShareSummary,
} from "@meally/shared";
import type { Db } from "../../db/index.js";
import { cookbookRecipes, cookbooks, recipeIngredients, recipes, recipeSteps, shareLinkRecipes, shareLinks } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import { listRecipes } from "../recipes/service.js";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const DAY = 86_400_000;

type Link = typeof shareLinks.$inferSelect;
type RecipeRow = typeof recipes.$inferSelect;
type Sharer = { id: string; name: string };

/** The flags that change what a public link shows. */
export interface ShareFlags {
  scaling: boolean;
  cookbooks: boolean;
  organizers: boolean;
  ratings: boolean;
}

async function recipeFor(db: Db, householdId: string, slug: string) {
  const [r] = await db.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.householdId, householdId), eq(recipes.slug, slug))).limit(1);
  if (!r) throw new ApiError(404, "not_found", "Recipe not found");
  return r;
}

/** Inserts a link and returns its token, shown once. */
async function insertLink(
  db: Db,
  householdId: string,
  sharer: Sharer,
  target: Pick<Link, "kind"> & Partial<Pick<Link, "recipeId" | "cookbookId" | "title">>,
  opts: CreateShare,
  now: Date,
  setRecipeIds: string[] = [],
) {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const days = opts.expiresInDays ?? null;
  await db.transaction(async (tx) => {
    await tx.insert(shareLinks).values({
      id,
      householdId,
      kind: target.kind,
      recipeId: target.recipeId ?? null,
      cookbookId: target.cookbookId ?? null,
      title: target.title || null,
      note: opts.note || null,
      sharerName: opts.showName === false ? null : sharer.name,
      tokenHash: hashToken(token),
      createdBy: sharer.id,
      createdAt: now,
      expiresAt: days ? new Date(now.getTime() + days * DAY) : null,
    });
    if (setRecipeIds.length) await tx.insert(shareLinkRecipes).values(setRecipeIds.map((recipeId, position) => ({ shareLinkId: id, recipeId, position })));
  });
  return token;
}

export async function createShare(db: Db, householdId: string, sharer: Sharer, slug: string, opts: CreateShare, now = new Date()) {
  const recipe = await recipeFor(db, householdId, slug);
  return insertLink(db, householdId, sharer, { kind: "recipe", recipeId: recipe.id }, opts, now);
}

/** A hand-picked set. Every slug must be one of the household's recipes, else 400 (nothing is created). */
export async function createSetShare(db: Db, householdId: string, sharer: Sharer, data: CreateShareSet, now = new Date()) {
  const rows = await db
    .select({ id: recipes.id, slug: recipes.slug })
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), inArray(recipes.slug, data.recipeSlugs)));
  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  const missing = data.recipeSlugs.filter((s) => !bySlug.has(s));
  if (missing.length) throw new ApiError(400, "unknown_recipes", `Recipes not found: ${missing.join(", ")}`);
  const ids = data.recipeSlugs.map((s) => bySlug.get(s)!);
  return insertLink(db, householdId, sharer, { kind: "set", title: data.title ?? null }, data, now, ids);
}

export async function createCookbookShare(db: Db, householdId: string, sharer: Sharer, slug: string, opts: CreateShare, now = new Date()) {
  const [cb] = await db.select({ id: cookbooks.id }).from(cookbooks).where(and(eq(cookbooks.householdId, householdId), eq(cookbooks.slug, slug))).limit(1);
  if (!cb) throw new ApiError(404, "not_found", "Cookbook not found");
  return insertLink(db, householdId, sharer, { kind: "cookbook", cookbookId: cb.id }, opts, now);
}

const active = (r: Link, now: Date) => !r.revokedAt && (!r.expiresAt || r.expiresAt > now);

export async function listShares(db: Db, householdId: string, slug: string, now = new Date()): Promise<ShareLink[]> {
  const recipe = await recipeFor(db, householdId, slug);
  const rows = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.recipeId, recipe.id), eq(shareLinks.householdId, householdId), isNull(shareLinks.revokedAt)))
    .orderBy(asc(shareLinks.createdAt));
  return rows
    .filter((r) => active(r, now))
    .map((r) => ({ id: r.id, createdAt: r.createdAt.getTime(), expiresAt: r.expiresAt?.getTime() ?? null, viewCount: r.viewCount }));
}

/** Every active link of the household, newest first, for the Shared links page. */
export async function listAllShares(db: Db, householdId: string, now = new Date()): Promise<ShareSummary[]> {
  const rows = await db
    .select({ link: shareLinks, recipeName: recipes.name, recipeSlug: recipes.slug, cookbookName: cookbooks.name, cookbookSlug: cookbooks.slug })
    .from(shareLinks)
    .leftJoin(recipes, eq(recipes.id, shareLinks.recipeId))
    .leftJoin(cookbooks, eq(cookbooks.id, shareLinks.cookbookId))
    .where(and(eq(shareLinks.householdId, householdId), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt), asc(shareLinks.id));
  const live = rows.filter((r) => active(r.link, now));
  const setIds = live.filter((r) => r.link.kind === "set").map((r) => r.link.id);
  const counts = setIds.length
    ? await db
        .select({ id: shareLinkRecipes.shareLinkId, n: count() })
        .from(shareLinkRecipes)
        .where(inArray(shareLinkRecipes.shareLinkId, setIds))
        .groupBy(shareLinkRecipes.shareLinkId)
    : [];
  const countOf = new Map(counts.map((c) => [c.id, c.n]));
  return live.map(({ link: l, recipeName, recipeSlug, cookbookName, cookbookSlug }) => ({
    id: l.id,
    kind: l.kind,
    title: l.kind === "recipe" ? recipeName : l.kind === "cookbook" ? cookbookName : l.title,
    targetSlug: l.kind === "recipe" ? recipeSlug : l.kind === "cookbook" ? cookbookSlug : null,
    count: l.kind === "set" ? (countOf.get(l.id) ?? 0) : null,
    sharedBy: l.sharerName,
    note: l.note,
    createdAt: l.createdAt.getTime(),
    expiresAt: l.expiresAt?.getTime() ?? null,
    viewCount: l.viewCount,
  }));
}

export async function revokeShare(db: Db, householdId: string, id: string, now = new Date()) {
  const rows = await db
    .update(shareLinks)
    .set({ revokedAt: now })
    .where(and(eq(shareLinks.id, id), eq(shareLinks.householdId, householdId), isNull(shareLinks.revokedAt)))
    .returning({ id: shareLinks.id });
  if (!rows.length) throw new ApiError(404, "not_found", "Link not found");
}

/** The active link for a token, or null when unknown, revoked or expired. */
export async function findActive(db: Db, token: string, now = new Date()) {
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hashToken(token))).limit(1);
  if (!row || !active(row, now)) return null;
  return row;
}

/**
 * The recipe ids a link shows, in order, all from the link's household; null when its target is gone or turned off.
 * A cookbook link is live: a smart cookbook re-runs its filter as the sharer (their favourites and ratings).
 */
async function linkRecipeIds(db: Db, link: Link, flags: ShareFlags): Promise<string[] | null> {
  if (link.kind === "recipe") return link.recipeId ? [link.recipeId] : null;
  if (link.kind === "set") {
    const rows = await db
      .select({ id: shareLinkRecipes.recipeId })
      .from(shareLinkRecipes)
      .innerJoin(recipes, and(eq(recipes.id, shareLinkRecipes.recipeId), eq(recipes.householdId, link.householdId)))
      .where(eq(shareLinkRecipes.shareLinkId, link.id))
      .orderBy(asc(shareLinkRecipes.position));
    return rows.map((r) => r.id);
  }
  if (!flags.cookbooks || !link.cookbookId) return null;
  const [cb] = await db.select().from(cookbooks).where(and(eq(cookbooks.id, link.cookbookId), eq(cookbooks.householdId, link.householdId))).limit(1);
  if (!cb) return null;
  if (cb.kind === "manual") {
    const rows = await db
      .select({ id: cookbookRecipes.recipeId })
      .from(cookbookRecipes)
      .where(eq(cookbookRecipes.cookbookId, cb.id))
      .orderBy(asc(cookbookRecipes.position), asc(cookbookRecipes.recipeId))
      .limit(SHARE_COOKBOOK_MAX);
    return rows.map((r) => r.id);
  }
  const f = cookbookFilterSchema.parse(cb.filter ?? {});
  // A favourites or rating filter belongs to the sharer. If their account is gone, show nothing rather than the
  // unfiltered library.
  if (flags.ratings && (f.favourites || f.minRating) && !link.createdBy) return [];
  const res = await listRecipes(db, link.householdId, {
    q: f.q,
    tag: f.tag,
    category: f.category,
    tool: f.tool,
    favourites: f.favourites,
    minRating: f.minRating,
    sort: "updated",
    limit: SHARE_COOKBOOK_MAX,
    org: flags.organizers,
    ratings: flags.ratings,
    userId: link.createdBy ?? undefined,
  });
  return res.items.map((i) => i.id);
}

async function linkTitle(db: Db, link: Link, first: RecipeRow | undefined) {
  if (link.kind === "recipe") return first?.name ?? null;
  if (link.kind === "set") return link.title;
  const [cb] = await db.select({ name: cookbooks.name }).from(cookbooks).where(eq(cookbooks.id, link.cookbookId!)).limit(1);
  return cb?.name ?? null;
}

const base = (token: string) => `/api/v1/public/shares/${token}/recipes`;

async function toPublicRecipe(db: Db, r: RecipeRow, img: string | null, scaling: boolean): Promise<PublicRecipe> {
  const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, r.id)).orderBy(asc(recipeIngredients.position));
  const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, r.id)).orderBy(asc(recipeSteps.position));
  return {
    name: r.name,
    description: r.description,
    yieldText: r.yieldText,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    sourceUrl: r.sourceUrl,
    notes: r.notes,
    imageUrl: r.imageId ? img : null,
    ingredients: ings.map(({ position, section, quantity, unit, food, note, raw }) => ({ position, section, quantity, unit, food, note, raw })),
    steps: steps.map(({ position, section, text }) => ({ position, section, text })),
    scaling,
  };
}

/** The landing payload for `/s/:token`. Counts a view. */
export async function publicShare(db: Db, token: string, flags: ShareFlags): Promise<PublicShare | null> {
  const link = await findActive(db, token);
  if (!link) return null;
  const ids = await linkRecipeIds(db, link, flags);
  if (!ids) return null;
  const rows = ids.length ? await db.select().from(recipes).where(and(eq(recipes.householdId, link.householdId), inArray(recipes.id, ids))) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is RecipeRow => !!r);
  if (link.kind === "recipe" && !ordered.length) return null;
  await db.update(shareLinks).set({ viewCount: link.viewCount + 1 }).where(eq(shareLinks.id, link.id));
  const items: PublicShareItem[] = ordered.map((r) => ({
    slug: r.slug,
    name: r.name,
    imageUrl: r.imageId ? `${base(token)}/${r.slug}/image/320` : null,
    totalMinutes: r.totalMinutes,
    servings: r.servings,
  }));
  const first = ordered[0];
  return {
    kind: link.kind,
    title: await linkTitle(db, link, first),
    note: link.note,
    sharedBy: link.sharerName,
    count: items.length,
    recipe: link.kind === "recipe" && first ? await toPublicRecipe(db, first, `${base(token)}/${first.slug}/image/800`, flags.scaling) : null,
    items,
  };
}

/** A recipe inside a link, addressed by its slug; null unless the link currently shows it. */
async function recipeInLink(db: Db, token: string, slug: string, flags: ShareFlags) {
  const link = await findActive(db, token);
  if (!link) return null;
  const ids = await linkRecipeIds(db, link, flags);
  if (!ids?.length) return null;
  const [r] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, link.householdId), eq(recipes.slug, slug), inArray(recipes.id, ids)))
    .limit(1);
  return r ?? null;
}

export async function publicShareRecipe(db: Db, token: string, slug: string, flags: ShareFlags): Promise<PublicRecipe | null> {
  const r = await recipeInLink(db, token, slug, flags);
  return r ? toPublicRecipe(db, r, `${base(token)}/${r.slug}/image/800`, flags.scaling) : null;
}

export async function publicShareImage(db: Db, token: string, slug: string, flags: ShareFlags) {
  const r = await recipeInLink(db, token, slug, flags);
  return r?.imageId ? { imageId: r.imageId, householdId: r.householdId } : null;
}

// ---- F16 single-recipe routes (`/public/recipes/:token`), kept for links already sent ----

async function singleRecipe(db: Db, token: string) {
  const link = await findActive(db, token);
  if (!link || link.kind !== "recipe" || !link.recipeId) return null;
  const [r] = await db.select().from(recipes).where(and(eq(recipes.id, link.recipeId), eq(recipes.householdId, link.householdId))).limit(1);
  return r ? { link, r } : null;
}

export async function publicRecipe(db: Db, token: string, scaling: boolean): Promise<PublicRecipe | null> {
  const found = await singleRecipe(db, token);
  if (!found) return null;
  await db.update(shareLinks).set({ viewCount: found.link.viewCount + 1 }).where(eq(shareLinks.id, found.link.id));
  return toPublicRecipe(db, found.r, `/api/v1/public/recipes/${token}/image/800`, scaling);
}

/** The image id and owning household for a token's recipe; used by the public image route. */
export async function publicImage(db: Db, token: string) {
  const found = await singleRecipe(db, token);
  return found?.r.imageId ? { imageId: found.r.imageId, householdId: found.r.householdId } : null;
}
