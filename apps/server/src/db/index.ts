import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof openDb>["db"];

/**
 * Opens SQLite through libsql (prebuilt binaries on every platform) at `file` or in memory.
 * Returns at once; `ready` resolves when pragmas are set and migrations applied.
 */
export function openDb(file: string) {
  const memory = file === ":memory:";
  if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true });
  // One connection: pragmas such as foreign_keys are per connection, and SQLite allows a single writer anyway.
  const client = createClient({ url: memory ? ":memory:" : pathToFileURL(path.resolve(file)).href, concurrency: 1 });
  const db = drizzle(client, { schema });
  const ready = (async () => {
    await client.execute("PRAGMA busy_timeout = 5000");
    if (!memory) await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA foreign_keys = ON");
    await migrate(db, { migrationsFolder: migrationsFolder() });
  })();
  ready.catch(() => {}); // surfaced to whoever awaits it
  return { db, client, ready };
}

/** Opens the database and waits until it is migrated and ready. */
export async function createDb(file: string) {
  const opened = openDb(file);
  await opened.ready;
  return opened;
}

// tsx: src/db/migrations. Bundle: dist/migrations (copied by tsup onSuccess).
function migrationsFolder() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "migrations"), path.join(here, "db/migrations")];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}
