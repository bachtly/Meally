import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db, DbHandle } from "./core.js";
import * as schema from "./schema/index.js";

/**
 * Connection options for short-lived edge isolates behind the Supabase transaction pooler.
 * - `prepare: false`: the pooler (pgbouncer / Supavisor) can't keep prepared statements.
 * - `idle_timeout`: an isolate can sit idle for minutes while the pooler or network drops the socket without telling
 *   us. postgres-js has no query timeout, so the next query on that dead socket waits for TCP to give up (minutes),
 *   and with `max: 1` every request queues behind it. Closing idle connections ourselves means a fresh connect instead.
 * - `max_lifetime`: recycle long-lived connections for the same reason. `connect_timeout`: fail fast, not after 30 s.
 */
export const EDGE_PG_OPTIONS = { prepare: false, idle_timeout: 5, max_lifetime: 60 * 5, connect_timeout: 10 } as const;

/** postgres-js without migrations, for runtimes with no file system (edge). The schema is applied out of band (`drizzle-kit migrate`). */
export function openPostgres(url: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(url, { ...EDGE_PG_OPTIONS, max: opts.max ?? 1, onnotice: () => {} });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, ready: Promise.resolve(), kind: "postgres", close: () => client.end({ timeout: 5 }) };
}
