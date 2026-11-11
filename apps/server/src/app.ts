import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { appName } from "@meally/shared";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

export const version = "0.0.0";

export interface AppOptions {
  /** Built web app directory; when it exists it is served with an SPA fallback. */
  webDist?: string;
}

export function createApp(opts: AppOptions = {}) {
  const app = new Hono();
  app.onError(errorHandler);

  const api = new Hono();
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
