import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db, DbHandle } from "./core.js";
import * as schema from "./schema/index.js";

type Options = postgres.Options<Record<string, postgres.PostgresType>>;

/**
 * Supabase's transaction pooler (port 6543) never answers pipelined queries, and postgres-js pipelines whenever
 * queries overlap: 5 parallel queries on 1 connection hang forever while the pooler shows the connection idle.
 * Turning pipelining off (`max_pipeline: 0`) breaks `sql.begin`, so use session mode (5432) instead.
 */
export const isTransactionPooler = (url: string) => {
  try {
    const u = new URL(url);
    return u.port === "6543" && u.hostname.endsWith(".pooler.supabase.com");
  } catch {
    return false;
  }
};

export interface PostgresOptions {
  /** Connections per process. Two, so one slow query does not queue every request; session mode has a small client limit. */
  max?: number;
  /** Seconds before an idle connection is closed. Short on the edge: a socket left idle can go silently dead. */
  idleTimeout?: number;
  /** Seconds a connection may live before it is replaced. */
  maxLifetime?: number;
  /** Seconds to wait for a connection before failing the query (instead of hanging). */
  connectTimeout?: number;
  /** Test hook: build the client (defaults to postgres-js). */
  connect?: (url: string, opts: Options) => postgres.Sql;
}

export interface PostgresHandle extends DbHandle {
  /**
   * Drops the current connections (without waiting for stuck queries) and opens fresh ones. Everything that
   * holds `db` keeps working: it is a stable proxy over the current client. Returns the last query sent.
   */
  reset(reason: string): string | undefined;
  /** How many times `reset` has run (for logs and tests). */
  readonly resets: number;
}

/**
 * postgres-js without migrations, for runtimes with no file system (edge). `prepare: false` so it works
 * behind pgbouncer / the Supabase pooler. The schema is applied out of band (`drizzle-kit migrate`).
 *
 * Point it at a direct or session-mode URL (see isTransactionPooler). As a safety net for any other stall, the
 * timeouts are short and `reset` lets the app swap in a fresh client when a request runs past its deadline.
 */
export function openPostgres(url: string, opts: PostgresOptions = {}): PostgresHandle {
  if (isTransactionPooler(url)) console.warn("[db] DATABASE_URL is the transaction pooler (6543); overlapping queries will hang. Use session mode (5432).");
  let lastQuery: string | undefined;
  const connect = opts.connect ?? ((u: string, o: Options) => postgres(u, o));
  const make = () => {
    const client = connect(url, {
      prepare: false,
      max: opts.max ?? 2,
      idle_timeout: opts.idleTimeout ?? 20,
      max_lifetime: opts.maxLifetime ?? 5 * 60,
      connect_timeout: opts.connectTimeout ?? 10,
      onnotice: () => {},
      debug: (_conn: number, query: string) => {
        lastQuery = query.replace(/\s+/g, " ").slice(0, 160);
      },
    });
    return { client, db: drizzle(client, { schema }) as unknown as Db };
  };
  let current = make();
  let resets = 0;

  // Methods are bound to the live Drizzle instance, so `db.select()` and `db.transaction()` always use it.
  const db = new Proxy({} as Db, {
    get(_t, prop) {
      const value = Reflect.get(current.db as object, prop);
      return typeof value === "function" ? value.bind(current.db) : value;
    },
    has: (_t, prop) => Reflect.has(current.db as object, prop),
  });

  return {
    db,
    ready: Promise.resolve(),
    kind: "postgres",
    close: () => current.client.end({ timeout: 5 }),
    reset(reason) {
      const old = current;
      current = make();
      resets++;
      // timeout 0: cancel whatever is stuck on the old connections now; their callers get an error.
      void old.client.end({ timeout: 0 }).catch(() => {});
      console.warn(`[db] reset #${resets}: ${reason}; last query: ${lastQuery ?? "(none)"}`);
      return lastQuery;
    },
    get resets() {
      return resets;
    },
  };
}
