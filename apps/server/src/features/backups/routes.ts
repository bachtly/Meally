import fs from "node:fs";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { version } from "../../app-core.js";
import { requireFeature } from "../features/middleware.js";
import { backupFile, backupSettings, createBackup, deleteBackup, listBackups } from "./service.js";


/** Instance backups, admin only. Mounted at /api/v1/admin/backups. */
export const backupRoutes = new Hono<AppEnv>();
backupRoutes.use("*", requireAuth, requireAdmin, requireFeature("backups"));

const settings = (c: Context<AppEnv>) => backupSettings(c.get("env"));

backupRoutes.get("/", async (c) => c.json({ items: await listBackups(c.get("dataDir")), schedule: settings(c) }));

backupRoutes.post("/", async (c) => {
  const b = await createBackup(c.get("db"), c.get("dataDir"), version, settings(c).keep);
  return c.json(b, 201);
});

backupRoutes.get("/:name", async (c) => {
  const file = backupFile(c.get("dataDir"), c.req.param("name"));
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st?.isFile()) throw new ApiError(404, "not_found", "Backup not found");
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(st.size),
      "content-disposition": `attachment; filename="${c.req.param("name")}"`,
      "cache-control": "no-store",
    },
  });
});

backupRoutes.delete("/:name", async (c) => {
  await deleteBackup(c.get("dataDir"), c.req.param("name"));
  return c.body(null, 204);
});
