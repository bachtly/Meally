import fs from "node:fs";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { version } from "../../app.js";
import { findRow } from "../recipes/service.js";
import { requireFeature } from "../features/middleware.js";
import { exportFormats, exportHousehold, exportOne, type ExportFormat } from "./export.js";
import { backupFile, backupSettings, createBackup, deleteBackup, listBackups } from "./service.js";
import { zipResponseStream } from "./zipwriter.js";


function format(c: Context<AppEnv>): ExportFormat {
  const f = c.req.query("format") ?? "jsonld";
  if (!(exportFormats as readonly string[]).includes(f)) throw new ApiError(400, "invalid_query", "format must be jsonld or markdown");
  return f as ExportFormat;
}

async function opts(c: Context<AppEnv>) {
  return {
    dataDir: c.get("dataDir"),
    householdId: c.get("householdId"),
    org: (await c.get("flags").getFeatures()).organizers.enabled,
  };
}

function zipResponse(body: ReadableStream<Uint8Array>, filename: string) {
  return new Response(body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/** Household export for any member, and single-recipe export. Mounted at /api/v1. */
export const exportRoutes = new Hono<AppEnv>();
for (const p of ["/export/*", "/recipes/:slug/export"]) exportRoutes.use(p, requireAuth, requireFeature("backups"));

exportRoutes.get("/export/recipes", async (c) => {
  const fmt = format(c);
  const o = await opts(c);
  const db = c.get("db");
  const day = new Date().toISOString().slice(0, 10);
  return zipResponse(zipResponseStream((z) => exportHousehold(db, z, o, fmt)), `meally-recipes-${fmt}-${day}.zip`);
});

exportRoutes.get("/recipes/:slug/export", async (c) => {
  const fmt = format(c);
  const o = await opts(c);
  const slug = c.req.param("slug");
  const db = c.get("db");
  // Fail with 404 before streaming starts.
  await findRow(db, o.householdId, slug);
  return zipResponse(zipResponseStream((z) => exportOne(db, z, o, slug, fmt)), `${slug}-${fmt}.zip`);
});

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
