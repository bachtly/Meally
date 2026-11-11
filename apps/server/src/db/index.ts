import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema/index.js";

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

/**
 * Where the database lives: DATABASE_URL (external Postgres) wins, otherwise PGlite persisted
 * under `<dataDir>/pgdata`.
 */
export function dbTarget(env: { DATABASE_URL?: string; DATA_DIR: string }): string {
  return env.DATABASE_URL?.trim() || path.join(env.DATA_DIR, "pgdata");
}

/**
 * Opens a database. `target` is a `postgres://` URL (postgres-js, prepare off so it works behind
 * pgbouncer / Supabase pooler), `memory://` (PGlite in memory) or a directory (PGlite persisted there).
 * Returns at once; `ready` resolves when migrations are applied.
 */
export function openDb(target: string): DbHandle {
  if (isPostgresUrl(target)) {
    const client = postgres(target, { prepare: false, onnotice: () => {} });
    const db = drizzlePostgres(client, { schema });
    const ready = migratePostgres(db, { migrationsFolder: migrationsFolder() });
    ready.catch(() => {});
    return { db: db as unknown as Db, ready, kind: "postgres", close: () => client.end({ timeout: 5 }) };
  }
  const memory = target.startsWith("memory://");
  if (!memory) fs.mkdirSync(target, { recursive: true });
  const pglite = new PGlite(memory ? "memory://" : target);
  const db = drizzlePglite(pglite, { schema });
  const ready = migratePglite(db, { migrationsFolder: migrationsFolder() });
  ready.catch(() => {});
  registerDumper(db, async () => {
    await pglite.exec("CHECKPOINT");
    return new Uint8Array(await (await pglite.dumpDataDir("gzip")).arrayBuffer());
  });
  return { db: db as unknown as Db, ready, kind: "pglite", pglite, close: () => pglite.close() };
}

const dumpers = new WeakMap<object, () => Promise<Uint8Array>>();

/** Lets backups snapshot an embedded database; external Postgres has no in-process dump (use pg_dump). */
export function registerDumper(db: object, fn: () => Promise<Uint8Array>) {
  dumpers.set(db, fn);
}
export const dumperFor = (db: object) => dumpers.get(db) ?? null;

/** Opens the database and waits until it is migrated and ready. */
export async function createDb(target: string) {
  const opened = openDb(target);
  await opened.ready;
  return opened;
}

/** Rows of a raw `db.execute()` result, whichever driver ran it. */
export function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

export async function queryRows<T = Record<string, unknown>>(db: Db, q: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(q));
}

// tsx: src/db/migrations. Bundle: dist/migrations (copied by tsup onSuccess).
function migrationsFolder() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "migrations"), path.join(here, "db/migrations")];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}

/** Number of migrations this build ships; a backup made by a newer build has a higher count. */
export function migrationCount(): number {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder(), "meta/_journal.json"), "utf8")) as { entries: unknown[] };
  return journal.entries.length;
}

/** Number of migrations applied to this database. */
export async function appliedMigrations(db: Db): Promise<number> {
  const r = await queryRows<{ n: number | string }>(db, sql`SELECT count(*) AS n FROM drizzle.__drizzle_migrations`).catch(() => null);
  return r ? Number(r[0]?.n ?? 0) : migrationCount();
}

/** Epoch milliseconds of a timestamp column, as a number, so keyset cursors can carry it. */
export const ms = (col: SQL | AnyColumn) => sql<number>`(extract(epoch from ${col}) * 1000)::double precision`;
