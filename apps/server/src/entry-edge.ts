/**
 * Edge entry (Supabase Edge Functions / Deno): exports a fetch handler. No Node-only imports; the build
 * guard (edge-guard.test.ts) fails if any reach the bundle. The schema is applied out of band.
 *
 * Env: DATABASE_URL (required), MEALLY_BASE_PATH (e.g. /meally), MEALLY_PBKDF2_ITERATIONS, BASE_URL, and the
 * usual MEALLY_* flag locks.
 */
import { createCoreApp } from "./app-core.js";
import { createEdgePlatform } from "./adapters/edge/index.js";
import { DEFAULT_PBKDF2_ITERATIONS } from "./features/auth/pbkdf2.js";
import { openPostgres, type PostgresHandle } from "./db/postgres.js";
import type { Db } from "./db/core.js";

type Env = Record<string, string | undefined>;

function readEnv(): Env {
  const g = globalThis as unknown as { Deno?: { env: { toObject(): Env } }; process?: { env: Env } };
  return g.Deno?.env.toObject() ?? g.process?.env ?? {};
}

export function normalizeBasePath(raw: string | undefined): string {
  const p = (raw ?? "").trim().replace(/\/+$/, "");
  return p && !p.startsWith("/") ? `/${p}` : p;
}

/** MEALLY_PUBLIC_URL (the browser-facing origin, e.g. the Vercel URL) is the CSRF/cookie origin, never the function Host. */
export function withPublicUrl(env: Env): Env {
  return env.MEALLY_PUBLIC_URL ? { ...env, BASE_URL: env.MEALLY_PUBLIC_URL } : env;
}

/** A request still running after this long is answered 503 and the database client is replaced. */
export const EDGE_REQUEST_DEADLINE_MS = 12_000;

/** `dbOrHandle` is a plain Db in tests; in production the resettable Postgres handle. */
export function createEdgeApp(rawEnv: Env = readEnv(), dbOrHandle: Db | PostgresHandle = openPostgres(requireUrl(rawEnv))) {
  const handle = "reset" in dbOrHandle ? (dbOrHandle as PostgresHandle) : null;
  const db = handle ? handle.db : (dbOrHandle as Db);
  const env = withPublicUrl(rawEnv);
  const n = Number(env.MEALLY_PBKDF2_ITERATIONS);
  const iterations = Number.isInteger(n) && n >= 1000 ? n : DEFAULT_PBKDF2_ITERATIONS;
  return createCoreApp({
    db,
    env,
    platform: createEdgePlatform({ pbkdf2Iterations: iterations, env }),
    basePath: normalizeBasePath(env.MEALLY_BASE_PATH),
    requestDeadlineMs: EDGE_REQUEST_DEADLINE_MS,
    onStall: ({ method, path, ms }) => void handle?.reset(`${method} ${path} stalled ${ms} ms`),
  });
}

function requireUrl(env: Env): string {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return env.DATABASE_URL;
}

let app: ReturnType<typeof createEdgeApp> | undefined;
/** Built on first request, so importing this module never opens a connection. */
export const fetch = (req: Request, ...rest: unknown[]): Response | Promise<Response> =>
  (app ??= createEdgeApp()).fetch(req, ...(rest as []));

export default { fetch };
