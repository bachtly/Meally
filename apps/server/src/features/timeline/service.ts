import { randomUUID } from "node:crypto";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { TimelineEvent, TimelineKind, TimelineResponse } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { images, recipes, recipeUserData, timelineEvents, users } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import type { ImageStore } from "../../ports/index.js";
import { decode, encode, findRow, imageUrl } from "../recipes/service.js";

export type Actor = { id: string; householdRole: "owner" | "member" };

function present(r: { e: typeof timelineEvents.$inferSelect; userName: string | null; slug: string; recipeName: string }, who: Actor): TimelineEvent {
  const mine = r.e.userId === who.id;
  return {
    id: r.e.id,
    kind: r.e.kind,
    text: r.e.text,
    rating: r.e.rating,
    imageUrl: imageUrl(r.e.imageId, 800),
    thumbUrl: imageUrl(r.e.imageId, 320),
    userId: r.e.userId,
    userName: r.userName ?? "Former member",
    recipeSlug: r.slug,
    recipeName: r.recipeName,
    createdAt: r.e.createdAt.getTime(),
    editedAt: r.e.editedAt?.getTime() ?? null,
    canEdit: mine,
    canDelete: mine || who.householdRole === "owner",
  };
}

const select = (db: Db) =>
  db
    .select({ e: timelineEvents, userName: users.name, slug: recipes.slug, recipeName: recipes.name })
    .from(timelineEvents)
    .innerJoin(recipes, eq(recipes.id, timelineEvents.recipeId))
    .leftJoin(users, eq(users.id, timelineEvents.userId));

/** Newest first; keyset pagination on (created_at, id). `recipeId` narrows to one recipe's timeline. */
export async function listTimeline(
  db: Db,
  householdId: string,
  who: Actor,
  opts: { recipeId?: string; cursor?: string; limit: number },
): Promise<TimelineResponse> {
  const conds: SQL[] = [eq(timelineEvents.householdId, householdId)];
  if (opts.recipeId) conds.push(eq(timelineEvents.recipeId, opts.recipeId));
  if (opts.cursor) {
    const [v, id] = decode(opts.cursor);
    conds.push(sql`(${timelineEvents.createdAt} < ${v} OR (${timelineEvents.createdAt} = ${v} AND ${timelineEvents.id} < ${id}))`);
  }
  const rows = await select(db)
    .where(and(...conds))
    .orderBy(desc(timelineEvents.createdAt), desc(timelineEvents.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => present(r, who)),
    nextCursor: rows.length > opts.limit && last ? encode(last.e.createdAt.getTime(), last.e.id) : null,
  };
}

async function getOne(db: Db, householdId: string, id: string, who: Actor) {
  const [r] = await select(db).where(and(eq(timelineEvents.id, id), eq(timelineEvents.householdId, householdId))).limit(1);
  if (!r) throw new ApiError(404, "not_found", "Event not found");
  return { raw: r.e, event: present(r, who) };
}

export async function addEvent(
  db: Db,
  householdId: string,
  who: Actor,
  slug: string,
  input: { kind: TimelineKind; text?: string | undefined; rating?: number | null | undefined },
  o: { ratings: boolean },
): Promise<TimelineEvent> {
  const recipe = await findRow(db, householdId, slug);
  const now = new Date();
  const id = randomUUID();
  await db.transaction(async (tx) => {
    let rating = input.kind === "made" ? (input.rating ?? null) : null;
    if (input.kind === "made" && o.ratings) {
      if (input.rating === undefined) {
        const [mine] = await tx
          .select({ rating: recipeUserData.rating })
          .from(recipeUserData)
          .where(and(eq(recipeUserData.userId, who.id), eq(recipeUserData.recipeId, recipe.id)));
        rating = mine?.rating ?? null;
      }
      await tx
        .insert(recipeUserData)
        .values({ userId: who.id, recipeId: recipe.id, favourite: false, rating: null, lastMadeAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [recipeUserData.userId, recipeUserData.recipeId], set: { lastMadeAt: now } });
    }
    await tx.insert(timelineEvents).values({
      id,
      householdId,
      recipeId: recipe.id,
      userId: who.id,
      kind: input.kind,
      text: input.text || null,
      rating,
      createdAt: now,
    });
  });
  return (await getOne(db, householdId, id, who)).event;
}

export async function updateEvent(db: Db, householdId: string, who: Actor, id: string, patch: { text?: string | undefined; rating?: number | null | undefined }) {
  const { raw } = await getOne(db, householdId, id, who);
  if (raw.userId !== who.id) throw new ApiError(403, "forbidden", "Only the author can edit this");
  if (patch.text === "" && raw.kind !== "made") throw new ApiError(400, "invalid_body", "text: Write something first");
  await db
    .update(timelineEvents)
    .set({
      ...(patch.text !== undefined ? { text: patch.text || null } : {}),
      ...(patch.rating !== undefined && raw.kind === "made" ? { rating: patch.rating } : {}),
      editedAt: new Date(),
    })
    .where(and(eq(timelineEvents.id, id), eq(timelineEvents.householdId, householdId)));
  return (await getOne(db, householdId, id, who)).event;
}

export async function deleteEvent(db: Db, store: ImageStore, householdId: string, who: Actor, id: string) {
  const { raw, event } = await getOne(db, householdId, id, who);
  if (!event.canDelete) throw new ApiError(403, "forbidden", "Only the author or a household owner can delete this");
  await db.transaction(async (tx) => {
    await tx.delete(timelineEvents).where(and(eq(timelineEvents.id, id), eq(timelineEvents.householdId, householdId)));
    if (raw.imageId) await tx.delete(images).where(eq(images.id, raw.imageId));
  });
  if (raw.imageId) await store.delete(householdId, raw.imageId);
}

export async function setEventImage(db: Db, store: ImageStore, householdId: string, who: Actor, id: string, input: Buffer) {
  const { raw } = await getOne(db, householdId, id, who);
  if (raw.userId !== who.id) throw new ApiError(403, "forbidden", "Only the author can edit this");
  const imageId = await store.putOriginal(householdId, input);
  await db.transaction(async (tx) => {
    await tx.insert(images).values({ id: imageId, householdId, createdAt: new Date() });
    await tx.update(timelineEvents).set({ imageId }).where(eq(timelineEvents.id, id));
    if (raw.imageId) await tx.delete(images).where(eq(images.id, raw.imageId));
  });
  if (raw.imageId) await store.delete(householdId, raw.imageId);
  return (await getOne(db, householdId, id, who)).event;
}
