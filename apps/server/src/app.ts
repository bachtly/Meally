import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { appName, signupModes, type SignupMode } from "@meally/shared";
import { createDb, type Db } from "./db/index.js";
import { createFlagsService, type FlagsService } from "./features/features/service.js";
import { featureRoutes } from "./features/features/routes.js";
import type { AppEnv, AuthSettings } from "./lib/context.js";
import { authRoutes } from "./features/auth/routes.js";
import { csrfProtection } from "./features/auth/middleware.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

export const version = "0.0.0";

export interface AppOptions {
  /** Built web app directory; when it exists it is served with an SPA fallback. */
  webDist?: string;
  /** Defaults to an in-memory database. */
  db?: Db;
  flags?: FlagsService;
  /** Environment used for flag locks; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** log2 of the scrypt cost; lowered in tests only. */
  scryptLogN?: number;
}

export function createApp(opts: AppOptions = {}) {
  const db = opts.db ?? createDb(":memory:").db;
  const flags = opts.flags ?? createFlagsService(db, opts.env ?? process.env);
  const env = opts.env ?? process.env;
  const baseUrl = parseBaseUrl(env.BASE_URL);
  const auth: AuthSettings = {
    lockedSignupMode: signupModes.find((m) => m === env.MEALLY_SIGNUP_MODE) as SignupMode | undefined ?? null,
    secureCookies: baseUrl.protocol === "https:",
    baseOrigin: baseUrl.origin,
    trustProxy: env.MEALLY_TRUST_PROXY === "true",
    scryptLogN: opts.scryptLogN ?? 17,
    loginLimiter: createRateLimiter({ max: 10, windowMs: 15 * 60_000 }),
    registerLimiter: createRateLimiter({ max: 20, windowMs: 60 * 60_000 }),
  };
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);

  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    c.set("db", db);
    c.set("flags", flags);
    c.set("auth", auth);
    await next();
  });
  api.use("*", csrfProtection);
  api.route("/auth", authRoutes);
  api.route("/features", featureRoutes);
  api.get("/health", (c) => c.json({ ok: true, version, name: appName }));
  app.route("/api/v1", api);
  app.all("/api/*", notFoundHandler);

  const dist = opts.webDist;
  if (dist && fs.existsSync(dist)) {
    const root = path.relative(process.cwd(), dist).replaceAll("\\", "/");
    const index = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    app.use("*", serveStatic({ root }));
    app.get("*", (c) => c.html(index));
  }
  return app;
}

function parseBaseUrl(raw: string | undefined): URL {
  try {
    return new URL(raw || "http://localhost:8080");
  } catch {
    return new URL("http://localhost:8080");
  }
}
