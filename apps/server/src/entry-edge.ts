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
import { openPostgres } from "./db/postgres.js";

type Env = Record<string, string | undefined>;

function readEnv(): Env {
  const g = globalThis as unknown as { Deno?: { env: { toObject(): Env } }; process?: { env: Env } };
  return g.Deno?.env.toObject() ?? g.process?.env ?? {};
}

export function normalizeBasePath(raw: string | undefined): string {
  const p = (raw ?? "").trim().replace(/\/+$/, "");
  return p && !p.startsWith("/") ? `/${p}` : p;
}

export function createEdgeApp(env: Env = readEnv(), db = openPostgres(requireUrl(env)).db) {
  const n = Number(env.MEALLY_PBKDF2_ITERATIONS);
  const iterations = Number.isInteger(n) && n >= 1000 ? n : DEFAULT_PBKDF2_ITERATIONS;
  return createCoreApp({ db, env, platform: createEdgePlatform({ pbkdf2Iterations: iterations, env }), basePath: normalizeBasePath(env.MEALLY_BASE_PATH) });
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
