import { eq, or, sql, type Column, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { friendships } from "../db/schema/friends.js";
import type { AppEnv } from "./context.js";

/**
 * The one place for the tenant rule (ADR 0002): a user reads and writes only rows they own. Friend reads
 * (accepted Friendships, on Snap paths only) are added here by the Friends work, never inline in a feature.
 */
export interface Viewer {
  userId: string;
}

/** The signed-in user of this request (session cookie or API token). */
export const viewerOf = (c: Context<AppEnv>): Viewer => ({ userId: c.get("user").id });

/** `WHERE <owner column> = viewer.userId`: scope a query to what the viewer owns. */
export const ownedBy = (column: Column, viewer: Viewer) => eq(column, viewer.userId);

/**
 * Snap paths only: `column` (a Snap's author) is the viewer or someone with an accepted Friendship with the
 * viewer. A pending or removed Friendship (no row) gives nothing.
 */
export const authoredByViewerOrFriend = (column: Column, viewer: Viewer): SQL => or(eq(column, viewer.userId), sql`${column} IN (${acceptedFriendIds(viewer)})`)!;

/**
 * Subquery of the user ids with an accepted Friendship with the viewer. Used for the Feed above and for push
 * fan-out (a new Snap notifies the author's Friends). Pending and removed Friendships give nothing.
 */
export const acceptedFriendIds = (viewer: Viewer): SQL => sql`
  SELECT CASE WHEN ${friendships.userAId} = ${viewer.userId} THEN ${friendships.userBId} ELSE ${friendships.userAId} END
  FROM ${friendships}
  WHERE ${friendships.status} = 'accepted' AND (${friendships.userAId} = ${viewer.userId} OR ${friendships.userBId} = ${viewer.userId})`;
