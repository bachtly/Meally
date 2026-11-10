import { foodRoutes, unitRoutes } from "./features/foods/routes.js";
import { organizerRoutes } from "./features/organizers/routes.js";
import { mealPlanRoutes } from "./features/mealplan/routes.js";
import { shoppingRoutes } from "./features/shopping/routes.js";
import { timelineRoutes } from "./features/timeline/routes.js";
import { backupRoutes, exportRoutes } from "./features/backups/routes.js";
import { adminRoutes } from "./features/admin/routes.js";
import { cookbookRoutes } from "./features/cookbooks/routes.js";
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
import { aiRoutes } from "./features/ai/routes.js";
import { allowPrivateUrls, createFetcher, type Fetcher } from "./features/import-url/fetch.js";
import { importRoutes } from "./features/import-url/routes.js";
import { importFileRoutes } from "./features/import-files/routes.js";
import type { Platform } from "./ports/index.js";
import { createNodePlatform } from "./adapters/node/index.js";
import { ShoppingBus, registerShoppingBus } from "./features/shopping/bus.js";
import { defineImportJob, failStaleJobs } from "./features/import-files/service.js";
import { recipeRoutes, imageRoutes } from "./features/recipes/routes.js";
import { csrfProtection } from "./features/auth/middleware.js";
import { householdRoutes } from "./features/households/routes.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import { publicRoutes, shareRoutes } from "./features/share/routes.js";
import { webhookRoutes } from "./features/webhooks/routes.js";
import { createDispatcher } from "./features/webhooks/service.js";
import { tokenRoutes } from "./features/tokens/routes.js";
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
  /** Host services (images, events, scheduler, hasher); defaults to the Node adapters. */
  platform?: Platform;
  /** log2 of the scrypt cost for the default platform; lowered in tests only. */
  scryptLogN?: number;
  /** Root for uploaded files; defaults to DATA_DIR or ./data. */
  dataDir?: string;
  /** SSRF-safe page fetcher; tests replace it. */
  fetcher?: Fetcher;
  /** Requests per 10 minutes per API token; lowered in tests only. */
  tokenLimit?: number;
  /** Starts the daily-digest timer; the server entry point turns this on. */
  webhookScheduler?: boolean;
  /** fetch used for AI provider calls; tests replace it. */
  aiFetch?: typeof fetch;
  /** AI requests per hour per user; lowered in tests only. */
  aiLimit?: number;
}

export function createApp(opts: AppOptions = {}) {
  const owned = opts.db ? null : openDb(":memory:");
  const db = opts.db ?? owned!.db;
  const flags = opts.flags ?? createFlagsService(db, opts.env ?? process.env);
  const env = opts.env ?? process.env;
  const dataDir = opts.dataDir ?? env.DATA_DIR ?? "./data";
  const platform = opts.platform ?? createNodePlatform({ dataDir, scryptLogN: opts.scryptLogN });
  registerShoppingBus(db, new ShoppingBus(platform.events));
  defineImportJob(platform.scheduler, db, platform.images);
  const baseUrl = parseBaseUrl(env.BASE_URL);
  const auth: AuthSettings = {
    lockedSignupMode: signupModes.find((m) => m === env.MEALLY_SIGNUP_MODE) as SignupMode | undefined ?? null,
    secureCookies: baseUrl.protocol === "https:",
    baseOrigin: baseUrl.origin,
    trustProxy: env.MEALLY_TRUST_PROXY === "true",
    loginLimiter: createRateLimiter({ max: 10, windowMs: 15 * 60_000 }),
    registerLimiter: createRateLimiter({ max: 20, windowMs: 60 * 60_000 }),
    inviteLimiter: createRateLimiter({ max: 30, windowMs: 15 * 60_000 }),
  };
  const fetcher = opts.fetcher ?? createFetcher({ allowPrivate: allowPrivateUrls(env), version });
  const webhooks = createDispatcher({ db, fetcher, flags, scheduler: platform.scheduler, allowPrivate: allowPrivateUrls(env) });
  if (opts.webhookScheduler) webhooks.start();
  const importLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60_000 });
  const shareLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });
  const tokenLimiter = createRateLimiter({ max: opts.tokenLimit ?? 600, windowMs: 10 * 60_000 });
  const aiLimiter = createRateLimiter({ max: opts.aiLimit ?? 30, windowMs: 60 * 60_000 });
  const aiFetch = opts.aiFetch ?? ((input, init) => fetch(input, init));
  void (owned?.ready ?? Promise.resolve()).then(() => failStaleJobs(db)).catch(() => {});
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);

  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    await owned?.ready;
    c.set("db", db);
    c.set("dataDir", dataDir);
    c.set("platform", platform);
    c.set("env", env);
    c.set("flags", flags);
    c.set("auth", auth);
    c.set("fetcher", fetcher);
    c.set("webhooks", webhooks);
    c.set("importLimiter", importLimiter);
    c.set("shareLimiter", shareLimiter);
    c.set("tokenLimiter", tokenLimiter);
    c.set("aiLimiter", aiLimiter);
    c.set("aiFetch", aiFetch);
    await next();
  });
  api.use("*", csrfProtection);
  api.route("/auth", authRoutes);
  api.route("/features", featureRoutes);
  api.route("/public", publicRoutes);
  api.route("/", shareRoutes);
  api.route("/", timelineRoutes);
  api.route("/", exportRoutes);
  api.route("/admin/backups", backupRoutes);
  api.route("/admin", adminRoutes);
  api.route("/recipes", recipeRoutes);
  api.route("/organizers", organizerRoutes);
  api.route("/foods", foodRoutes);
  api.route("/units", unitRoutes);
  api.route("/meal-plan", mealPlanRoutes);
  api.route("/shopping", shoppingRoutes);
  api.route("/tokens", tokenRoutes);
  api.route("/ai", aiRoutes);
  api.route("/webhooks", webhookRoutes);
  api.route("/cookbooks", cookbookRoutes);
  api.route("/household", householdRoutes);
  api.route("/ingredients", ingredientRoutes);
  api.route("/import/url", importRoutes);
  api.route("/import", importFileRoutes);
  api.route("/images", imageRoutes);
  api.get("/health", (c) => c.json({ ok: true, version, name: appName }));
  app.route("/api/v1", api);
  app.all("/api/*", notFoundHandler);

  const dist = opts.webDist;
  if (dist && fs.existsSync(dist)) {
    const root = path.relative(process.cwd(), dist).replaceAll("\\", "/");
    const index = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    // The service worker and manifest must always revalidate so updates roll out; Workbox chunks are hashed.
    app.use("*", async (c, next) => {
      await next();
      const p = c.req.path;
      if (c.res.status === 200 && (p === "/sw.js" || p === "/manifest.webmanifest" || p === "/registerSW.js")) {
        c.res.headers.set("Cache-Control", "no-cache");
      } else if (c.res.status === 200 && /^\/workbox-[\w-]+\.js$/.test(p)) {
        c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      }
    });
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
