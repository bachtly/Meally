import { organizerRoutes } from "./features/organizers/routes.js";
import { mealPlanRoutes } from "./features/mealplan/routes.js";
import { shoppingRoutes } from "./features/shopping/routes.js";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { appName, signupModes, type SignupMode } from "@meally/shared";
import { openDb, type Db } from "./db/index.js";
import { createFlagsService, type FlagsService } from "./features/features/service.js";
import { featureRoutes } from "./features/features/routes.js";
import type { AppEnv, AuthSettings } from "./lib/context.js";
import { authRoutes } from "./features/auth/routes.js";
import { ingredientRoutes } from "./features/ingredients/routes.js";
import { createFetcher, type Fetcher } from "./features/import-url/fetch.js";
import { importRoutes } from "./features/import-url/routes.js";
import { recipeRoutes, imageRoutes } from "./features/recipes/routes.js";
import { csrfProtection } from "./features/auth/middleware.js";
import { householdRoutes } from "./features/households/routes.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import { publicRoutes, shareRoutes } from "./features/share/routes.js";
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
  /** Root for uploaded files; defaults to DATA_DIR or ./data. */
  dataDir?: string;
  /** SSRF-safe page fetcher; tests replace it. */
  fetcher?: Fetcher;
}

export function createApp(opts: AppOptions = {}) {
  const owned = opts.db ? null : openDb(":memory:");
  const db = opts.db ?? owned!.db;
  const flags = opts.flags ?? createFlagsService(db, opts.env ?? process.env);
  const env = opts.env ?? process.env;
  const dataDir = opts.dataDir ?? env.DATA_DIR ?? "./data";
  const baseUrl = parseBaseUrl(env.BASE_URL);
  const auth: AuthSettings = {
    lockedSignupMode: signupModes.find((m) => m === env.MEALLY_SIGNUP_MODE) as SignupMode | undefined ?? null,
    secureCookies: baseUrl.protocol === "https:",
    baseOrigin: baseUrl.origin,
    trustProxy: env.MEALLY_TRUST_PROXY === "true",
    scryptLogN: opts.scryptLogN ?? 17,
    loginLimiter: createRateLimiter({ max: 10, windowMs: 15 * 60_000 }),
    registerLimiter: createRateLimiter({ max: 20, windowMs: 60 * 60_000 }),
    inviteLimiter: createRateLimiter({ max: 30, windowMs: 15 * 60_000 }),
  };
  const fetcher = opts.fetcher ?? createFetcher({ allowPrivate: env.MEALLY_IMPORT_ALLOW_PRIVATE === "true", version });
  const importLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60_000 });
  const shareLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);

  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    await owned?.ready;
    c.set("db", db);
    c.set("dataDir", dataDir);
    c.set("flags", flags);
    c.set("auth", auth);
    c.set("fetcher", fetcher);
    c.set("importLimiter", importLimiter);
    c.set("shareLimiter", shareLimiter);
    await next();
  });
  api.use("*", csrfProtection);
  api.route("/auth", authRoutes);
  api.route("/features", featureRoutes);
  api.route("/public", publicRoutes);
  api.route("/", shareRoutes);
  api.route("/recipes", recipeRoutes);
  api.route("/organizers", organizerRoutes);
  api.route("/meal-plan", mealPlanRoutes);
  api.route("/shopping", shoppingRoutes);
  api.route("/household", householdRoutes);
  api.route("/ingredients", ingredientRoutes);
  api.route("/import/url", importRoutes);
  api.route("/images", imageRoutes);
  api.get("/health", (c) => c.json({ ok: true, version, name: appName }));
  app.route("/api/v1", api);
  app.all("/api/*", notFoundHandler);

  const dist = opts.webDist;
  if (dist && fs.existsSync(dist)) {
    const root = path.relative(process.cwd(), dist).replaceAll("\\", "/");
    const index = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    app.use("*", serveStatic({ root }));
    app.get("*", (c) => {
      if (c.req.path.startsWith("/s/")) {
        c.header("Referrer-Policy", "no-referrer");
        c.header("X-Robots-Tag", "noindex, nofollow");
      }
      return c.html(index);
    });
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
