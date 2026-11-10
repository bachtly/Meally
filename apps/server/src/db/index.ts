import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>["db"];

/** Opens SQLite at `file` (or in memory), enables WAL and applies pending migrations. */
export function createDb(file: string) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  return { db, sqlite };
}

// tsx: src/db/migrations. Bundle: dist/migrations (copied by tsup onSuccess).
function migrationsFolder() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "migrations"), path.join(here, "db/migrations")];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}
