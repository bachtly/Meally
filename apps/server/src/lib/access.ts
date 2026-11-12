import { eq, type Column } from "drizzle-orm";
import type { Context } from "hono";
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
