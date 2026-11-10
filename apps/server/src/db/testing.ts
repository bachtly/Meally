import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { dumperFor, openDb, queryRows, registerDumper, type DbHandle } from "./index.js";

/**
 * Test database: one migrated instance per process (per test file), emptied each time it is opened.
 * PGlite in memory by default; when DATABASE_URL is set, a throwaway database on that server is used
 * instead, so the same suite exercises both drivers. `pglite: true` forces the embedded driver (backups need it).
 */
const shared: Record<string, Promise<DbHandle> | undefined> = {};

async function create(forcePglite: boolean): Promise<DbHandle> {
  const url = forcePglite ? undefined : process.env.DATABASE_URL;
  if (!url) {
    const h = openDb("memory://");
    await h.ready;
    return h;
  }
  const name = `meally_test_${process.pid}_${randomBytes(4).toString("hex")}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(url);
  u.pathname = `/${name}`;
  const h = openDb(u.toString());
  await h.ready;
  return h;
}

/** Same shape as openDb(): returns at once, `ready` resolves when the database is empty and usable. */
export function openTestDb(opts: { pglite?: boolean } = {}): DbHandle {
  const key = opts.pglite ? "pglite" : "default";
  const inst = (shared[key] ??= create(!!opts.pglite));
  const target: { h?: DbHandle } = {};
  const ready = (async () => {
    const h = await inst;
    const tables = await queryRows<{ tablename: string }>(h.db, sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    if (tables.length) await h.db.execute(sql.raw(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`));
    target.h = h;
  })();
  ready.catch(() => {});
  // createApp() captures `db` before `ready`, so hand out a stable proxy onto the shared instance.
  const db = new Proxy({} as DbHandle["db"], {
    get(_t, prop) {
      if (!target.h) throw new Error(`test db used before ready (${String(prop)})`);
      const v = (target.h.db as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === "function" ? v.bind(target.h.db) : v;
    },
  });
  registerDumper(db, async () => {
    const dump = target.h && dumperFor(target.h.db);
    if (!dump) throw new Error("no dumper for this test database");
    return dump();
  });
  return {
    db,
    ready,
    get kind() {
      return target.h!.kind;
    },
    get pglite() {
      return target.h?.pglite;
    },
    close: async () => {},
  };
}

export async function createTestDb(opts: { pglite?: boolean } = {}) {
  const h = openTestDb(opts);
  await h.ready;
  return h;
}
