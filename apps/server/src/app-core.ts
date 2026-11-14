import { foodRoutes, unitRoutes } from "./features/foods/routes.js";
import { organizerRoutes } from "./features/organizers/routes.js";
import { mealPlanRoutes } from "./features/mealplan/routes.js";
import { shoppingRoutes } from "./features/shopping/routes.js";
import { timelineRoutes } from "./features/timeline/routes.js";
import { exportRoutes } from "./features/backups/export-routes.js";
import { adminRoutes } from "./features/admin/routes.js";
import { cookbookRoutes } from "./features/cookbooks/routes.js";
import { Hono } from "hono";
import { appName, signupModes, type SignupMode } from "@meally/shared";
import type { Db } from "./db/index.js";
import { createFlagsService, type FlagsService } from "./features/features/service.js";
import { featureRoutes } from "./features/features/routes.js";
import type { AppEnv, AuthSettings } from "./lib/context.js";
import { authRoutes } from "./features/auth/routes.js";
import { ingredientRoutes } from "./features/ingredients/routes.js";
import { aiRoutes } from "./features/ai/routes.js";
import { allowPrivateUrls, createFetcher, type Fetcher } from "./features/import-url/fetch.js";
import { importRoutes } from "./features/import-url/routes.js";
import type { Platform } from "./ports/index.js";
import { ShoppingBus, registerShoppingBus } from "./features/shopping/bus.js";
import { recipeRoutes, imageRoutes } from "./features/recipes/routes.js";
import { csrfProtection } from "./features/auth/middleware.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import { publicRoutes, shareRoutes } from "./features/share/routes.js";
import { friendRoutes } from "./features/friends/routes.js";
import { snapRoutes } from "./features/snaps/routes.js";
import { webhookRoutes } from "./features/webhooks/routes.js";
import { createDispatcher } from "./features/webhooks/service.js";
import { createPushDeliverer } from "./features/push/service.js";
import { pushRoutes } from "./features/push/routes.js";
import { tokenRoutes } from "./features/tokens/routes.js";
import { jobRoutes, defineCoreJobs } from "./features/jobs/routes.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

export const version = "0.0.0";

export interface CoreAppOptions {
  db: Db;
  platform: Platform;
  /** Environment for flag locks and settings; the caller reads it (process.env, Deno.env). */
  env: Record<string, string | undefined>;
  /** Resolves when the database is usable; every API request waits for it. */
  ready?: Promise<void>;
  flags?: FlagsService;
  /** Root for uploaded files (Node only); empty on platforms without a disk. */
  dataDir?: string;
  /** SSRF-safe page fetcher; tests replace it. Defaults to the fetch-based one. */
  fetcher?: Fetcher;
  /** Requests per 10 minutes per API token; lowered in tests only. */
  tokenLimit?: number;
  /** Starts the daily-digest timer; the server entry point turns this on. */
  webhookScheduler?: boolean;
  /** fetch used for AI provider calls; tests replace it. */
  aiFetch?: typeof fetch;
  /** AI requests per hour per user; lowered in tests only. */
  aiLimit?: number;
  /** Serve everything under this prefix (e.g. `/meally` behind `/functions/v1`). */
  basePath?: string;
  /** Mounts routes that need Node (instance backups) before the core routes. */
  mountEarly?: (api: Hono<AppEnv>) => void;
  /** Mounts routes that need Node (file import) after the core routes. */
  mountLate?: (api: Hono<AppEnv>) => void;
}

/** The runtime-neutral app: no file system, no sharp, no embedded database. Node and edge entries both build on it. */
export function createCoreApp(opts: CoreAppOptions) {
  const { db, platform, env } = opts;
  const flags = opts.flags ?? createFlagsService(db, env);
  const dataDir = opts.dataDir ?? "";
  registerShoppingBus(db, new ShoppingBus(platform.events));
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
  // Background jobs (the server entry turns them on) also send each push right after it is queued.
  const push = createPushDeliverer({ db, scheduler: platform.scheduler, fetcher, flags, env, sendNow: !!opts.webhookScheduler });
  defineCoreJobs(platform.scheduler, db, platform.images);
  if (opts.webhookScheduler) {
    webhooks.start();
    push.start();
  }
  const importLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60_000 });
  const shareLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });
  const tokenLimiter = createRateLimiter({ max: opts.tokenLimit ?? 600, windowMs: 10 * 60_000 });
  const aiLimiter = createRateLimiter({ max: opts.aiLimit ?? 30, windowMs: 60 * 60_000 });
  const aiFetch = opts.aiFetch ?? ((input, init) => fetch(input, init));
  const root = new Hono<AppEnv>();
  const app = (opts.basePath ? root.basePath(opts.basePath) : root) as Hono<AppEnv>;
  app.onError(errorHandler);

  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    await opts.ready;
    c.set("db", db);
    c.set("dataDir", dataDir);
    c.set("platform", platform);
    c.set("env", env);
    c.set("flags", flags);
    c.set("auth", auth);
    c.set("fetcher", fetcher);
    c.set("webhooks", webhooks);
    c.set("push", push);
    c.set("importLimiter", importLimiter);
    c.set("shareLimiter", shareLimiter);
    c.set("tokenLimiter", tokenLimiter);
    c.set("aiLimiter", aiLimiter);
    c.set("aiFetch", aiFetch);
    await next();
  });
  // Machine-to-machine: authenticated by the jobs secret, so no cookie CSRF check applies.
  api.route("/internal", jobRoutes);
  api.use("*", csrfProtection);
  api.route("/auth", authRoutes);
  api.route("/features", featureRoutes);
  api.get("/meta", (c) =>
    c.json({ streaming: platform.events.supportsStreaming, presizedImages: platform.images.acceptsPresized, platform: platform.name }),
  );
  api.route("/public", publicRoutes);
  api.route("/", shareRoutes);
  api.route("/", timelineRoutes);
  api.route("/", exportRoutes);
  opts.mountEarly?.(api);
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
  api.route("/friends", friendRoutes);
  api.route("/snaps", snapRoutes);
  api.route("/push", pushRoutes);
  api.route("/cookbooks", cookbookRoutes);
  api.route("/ingredients", ingredientRoutes);
  api.route("/import/url", importRoutes);
  opts.mountLate?.(api);
  api.route("/images", imageRoutes);
  api.get("/health", (c) => c.json({ ok: true, version, name: appName }));
  app.route("/api/v1", api);
  app.all("/api/*", notFoundHandler);
  return app;
}


function parseBaseUrl(raw: string | undefined): URL {
  try {
    return new URL(raw || "http://localhost:8080");
  } catch {
    return new URL("http://localhost:8080");
  }
}
