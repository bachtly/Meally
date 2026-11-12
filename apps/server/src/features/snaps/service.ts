import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { ImageSize, ReactionKey, Snap, SnapCreate, SnapListResponse } from "@meally/shared";
import { ms, type Db } from "../../db/core.js";
import { images, reactions, recipes, snaps, users } from "../../db/schema/index.js";
import { authoredByViewerOrFriend, type Viewer } from "../../lib/access.js";
import { ApiError } from "../../lib/errors.js";
import type { ImageStore } from "../../ports/index.js";
import { storeImage, type ImageInput } from "../recipes/image-input.js";
import { decode, encode } from "../recipes/service.js";

/** Immutable-cache safe: the URL carries the image id, and an image never changes under an id. */
export const snapImageUrl = (snapId: string, imageId: string, size: ImageSize) =>
  `/api/v1/snaps/${snapId}/images/${imageId}/${size}`;

/** Runs at most `max` tasks at once; the rest wait their turn. Bounds CPU and memory of image processing. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export const SNAP_PROCESSING_LIMIT = 2;
const processing = createLimiter(SNAP_PROCESSING_LIMIT);

type Row = {
  s: typeof snaps.$inferSelect;
  authorName: string | null;
  recipeSlug: string | null;
  recipeName: string | null;
};

const selectSnaps = (db: Db) =>
  db
    .select({ s: snaps, authorName: users.name, recipeSlug: recipes.slug, recipeName: recipes.name })
    .from(snaps)
    .leftJoin(users, eq(users.id, snaps.userId))
    .leftJoin(recipes, eq(recipes.id, snaps.recipeId));

/** Adds the viewer's own Reactions, and every Reaction on Snaps the viewer wrote. Removed Reactions are skipped. */
async function present(db: Db, viewer: Viewer, rows: Row[]): Promise<Snap[]> {
  if (!rows.length) return [];
  const live = await db
    .select({ r: reactions, name: users.name })
    .from(reactions)
    .leftJoin(users, eq(users.id, reactions.userId))
    .where(
      and(
        inArray(
          reactions.snapId,
          rows.map((r) => r.s.id),
        ),
        isNull(reactions.removedAt),
      ),
    )
    .orderBy(reactions.createdAt, reactions.userId);
  return rows.map(({ s, authorName, recipeSlug, recipeName }) => {
    const onSnap = live.filter((x) => x.r.snapId === s.id);
    const snap: Snap = {
      id: s.id,
      author: { id: s.userId, name: authorName ?? "Former user" },
      imageUrl: snapImageUrl(s.id, s.imageId, 800),
      thumbUrl: snapImageUrl(s.id, s.imageId, 320),
      caption: s.caption,
      dishName: s.dishName,
      place: s.place,
      recipe: s.recipeId && recipeSlug && recipeName ? { slug: recipeSlug, name: recipeName } : null,
      createdAt: s.createdAt.getTime(),
      myReactions: onSnap.filter((x) => x.r.userId === viewer.userId).map((x) => x.r.emoji as ReactionKey),
    };
    if (s.userId === viewer.userId) {
      snap.reactions = onSnap.map((x) => ({ userId: x.r.userId, name: x.name ?? "Former user", emoji: x.r.emoji as ReactionKey }));
    }
    return snap;
  });
}

/** A Snap the viewer wrote or an accepted Friend wrote; anything else is a 404. */
export async function getSnap(db: Db, viewer: Viewer, id: string): Promise<Snap> {
  const rows = await selectSnaps(db)
    .where(and(eq(snaps.id, id), authoredByViewerOrFriend(snaps.userId, viewer)))
    .limit(1);
  const [snap] = await present(db, viewer, rows);
  if (!snap) throw new ApiError(404, "not_found", "Snap not found");
  return snap;
}

/** The Feed: the viewer's and accepted Friends' Snaps, newest first, keyset on (created_at, id). */
export async function listFeed(db: Db, viewer: Viewer, opts: { cursor?: string; limit: number }): Promise<SnapListResponse> {
  const conds: SQL[] = [authoredByViewerOrFriend(snaps.userId, viewer)];
  if (opts.cursor) {
    const [v, id] = decode(opts.cursor);
    const t = ms(snaps.createdAt);
    conds.push(sql`(${t} < ${v} OR (${t} = ${v} AND ${snaps.id} < ${id}))`);
  }
  const rows = await selectSnaps(db)
    .where(and(...conds))
    .orderBy(desc(snaps.createdAt), desc(snaps.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: await present(db, viewer, page),
    nextCursor: rows.length > opts.limit && last ? encode(last.s.createdAt.getTime(), last.s.id) : null,
  };
}

const existing = async (db: Db, userId: string, clientId: string) => {
  const [row] = await db
    .select({ id: snaps.id })
    .from(snaps)
    .where(and(eq(snaps.userId, userId), eq(snaps.clientId, clientId)))
    .limit(1);
  return row?.id ?? null;
};

class LostRace extends Error {}

/**
 * Sends a Snap. A retry with the same `clientId` returns the first Snap (`created: false`) without storing a
 * second image. Two sends racing on one `clientId`: the unique index picks the winner and the loser deletes
 * the image it just stored. A Linked recipe must be the sender's own, else 404.
 */
export async function createSnap(
  db: Db,
  store: ImageStore,
  viewer: Viewer,
  body: SnapCreate,
  upload: () => Promise<ImageInput>,
): Promise<{ snap: Snap; created: boolean }> {
  const userId = viewer.userId;
  const done = async (id: string, created: boolean) => ({ snap: await getSnap(db, viewer, id), created });
  const first = await existing(db, userId, body.clientId);
  if (first) return done(first, false);
  if (body.recipeId) {
    const [r] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, body.recipeId), eq(recipes.userId, userId)))
      .limit(1);
    if (!r) throw new ApiError(404, "not_found", "Recipe not found");
  }
  const input = await upload();
  const imageId = await processing(() => storeImage(store, userId, input));
  const id = randomUUID();
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(images).values({ id: imageId, userId, createdAt: now });
      const inserted = await tx
        .insert(snaps)
        .values({
          id,
          userId,
          imageId,
          clientId: body.clientId,
          caption: body.caption || null,
          dishName: body.dishName || null,
          place: body.place || null,
          recipeId: body.recipeId ?? null,
          createdAt: now,
        })
        .onConflictDoNothing({ target: [snaps.userId, snaps.clientId] })
        .returning({ id: snaps.id });
      if (!inserted.length) throw new LostRace();
    });
  } catch (e) {
    await store.delete(userId, imageId).catch(() => {});
    if (!(e instanceof LostRace)) throw e;
    const winner = await existing(db, userId, body.clientId);
    if (!winner) throw new Error("Snap vanished after a lost race");
    return done(winner, false);
  }
  return done(id, true);
}

/** Author only: another user, a Friend and a stranger all get a 404. */
export async function deleteSnap(db: Db, store: ImageStore, viewer: Viewer, id: string): Promise<void> {
  const imageId = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(snaps)
      .where(and(eq(snaps.id, id), eq(snaps.userId, viewer.userId)))
      .returning({ imageId: snaps.imageId });
    if (!row) return null;
    // Reactions go with the Snap (cascade). The Image is the Snap's own, so it goes too.
    await tx.delete(images).where(and(eq(images.id, row.imageId), eq(images.userId, viewer.userId)));
    return row.imageId;
  });
  if (!imageId) throw new ApiError(404, "not_found", "Snap not found");
  await store.delete(viewer.userId, imageId);
}

/** Bytes of a Snap's image for the author or an accepted Friend. `imageId` must be the Snap's own Image. */
export async function readSnapImage(db: Db, store: ImageStore, viewer: Viewer, snapId: string, imageId: string, size: ImageSize) {
  const [row] = await db
    .select({ userId: snaps.userId, imageId: snaps.imageId })
    .from(snaps)
    .where(and(eq(snaps.id, snapId), eq(snaps.imageId, imageId), authoredByViewerOrFriend(snaps.userId, viewer)))
    .limit(1);
  const data = row ? await store.get(row.userId, row.imageId, size) : null;
  if (!data) throw new ApiError(404, "not_found", "Image not found");
  return data;
}
