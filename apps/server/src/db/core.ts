import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PGlite } from "@electric-sql/pglite";
import type * as schema from "./schema/index.js";

/**
 * Runtime-neutral database pieces: the `Db` type and query helpers. Nothing here touches the file system
 * or a driver, so the edge bundle can import it. Drivers live in `index.ts` (PGlite, Node) and `postgres.ts`.
 */

/** The one Drizzle type every query module uses; both drivers satisfy it. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  /** Resolves once migrations are applied. */
  ready: Promise<void>;
  kind: "pglite" | "postgres";
  /** Present for the embedded PGlite driver; backups use it to snapshot the data directory. */
  pglite?: PGlite;
  close(): Promise<void>;
}

export const isPostgresUrl = (s: string) => /^postgres(ql)?:\/\//i.test(s);

const dumpers = new WeakMap<object, () => Promise<Uint8Array>>();

/** Lets backups snapshot an embedded database; external Postgres has no in-process dump (use pg_dump). */
export function registerDumper(db: object, fn: () => Promise<Uint8Array>) {
  dumpers.set(db, fn);
}
export const dumperFor = (db: object) => dumpers.get(db) ?? null;

/** Rows of a raw `db.execute()` result, whichever driver ran it. */
export function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

export async function queryRows<T = Record<string, unknown>>(db: Db, q: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(q));
}

/** Number of migrations applied to this database, or null when the migrations table does not exist. */
export async function countAppliedMigrations(db: Db): Promise<number | null> {
  const r = await queryRows<{ n: number | string }>(db, sql`SELECT count(*) AS n FROM drizzle.__drizzle_migrations`).catch(() => null);
  return r ? Number(r[0]?.n ?? 0) : null;
}

/** Epoch milliseconds of a timestamp column, as a number, so keyset cursors can carry it. */
export const ms = (col: SQL | AnyColumn) => sql<number>`(extract(epoch from ${col}) * 1000)::double precision`;
