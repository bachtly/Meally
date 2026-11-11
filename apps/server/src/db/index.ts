import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { countAppliedMigrations, isPostgresUrl, registerDumper, type DbHandle, type Db } from "./core.js";
import * as schema from "./schema/index.js";

export * from "./core.js";
export type { Db, DbHandle } from "./core.js";

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

/** Opens the database and waits until it is migrated and ready. */
export async function createDb(target: string) {
  const opened = openDb(target);
  await opened.ready;
  return opened;
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

/** Number of migrations applied to this database (falls back to the bundled count). */
export async function appliedMigrations(db: Db): Promise<number> {
  return (await countAppliedMigrations(db)) ?? migrationCount();
}
