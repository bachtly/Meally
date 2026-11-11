import fs from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Db } from "./db/index.js";
import { openTestDb } from "./db/testing.js";
import { createFlagsService, type FlagsService } from "./features/features/service.js";
import { createCoreApp, version, type CoreAppOptions } from "./app-core.js";
import { createNodeFetcher } from "./features/import-url/node-transport.js";
import { allowPrivateUrls, type Fetcher } from "./features/import-url/fetch.js";
import { importFileRoutes } from "./features/import-files/routes.js";
import { backupRoutes } from "./features/backups/routes.js";
import { defineImportJob, failStaleJobs } from "./features/import-files/service.js";
import type { Platform } from "./ports/index.js";
import { createNodePlatform } from "./adapters/node/index.js";

export { version };

export interface AppOptions extends Partial<Pick<CoreAppOptions, "tokenLimit" | "webhookScheduler" | "aiFetch" | "aiLimit" | "basePath">> {
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
}

/** The Node server: the core app plus instance backups, file import and static web serving. */
export function createApp(opts: AppOptions = {}) {
  const owned = opts.db ? null : openTestDb();
  const db = opts.db ?? owned!.db;
  const env = opts.env ?? process.env;
  const flags = opts.flags ?? createFlagsService(db, env);
  const dataDir = opts.dataDir ?? env.DATA_DIR ?? "./data";
  const platform = opts.platform ?? createNodePlatform({ dataDir, scryptLogN: opts.scryptLogN });
  defineImportJob(platform.scheduler, db, platform.images);
  void (owned?.ready ?? Promise.resolve()).then(() => failStaleJobs(db)).catch(() => {});
  const app = createCoreApp({
    ...opts,
    db,
    env,
    flags,
    dataDir,
    platform,
    ready: owned?.ready,
    fetcher: opts.fetcher ?? createNodeFetcher({ allowPrivate: allowPrivateUrls(env), version }),
    mountEarly: (api) => api.route("/admin/backups", backupRoutes),
    mountLate: (api) => api.route("/import", importFileRoutes),
  });

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
