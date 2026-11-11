import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db, DbHandle } from "./core.js";
import * as schema from "./schema/index.js";

/**
 * postgres-js without migrations, for runtimes with no file system (edge). `prepare: false` so it works
 * behind pgbouncer / the Supabase pooler. The schema is applied out of band (`drizzle-kit migrate`).
 */
export function openPostgres(url: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(url, { prepare: false, max: opts.max ?? 1, onnotice: () => {} });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, ready: Promise.resolve(), kind: "postgres", close: () => client.end({ timeout: 5 }) };
}
