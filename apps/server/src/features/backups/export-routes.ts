import { Hono, type Context } from "hono";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { findRow } from "../recipes/service.js";
import { exportFormats, exportHousehold, exportOne, type ExportFormat } from "./export.js";
import { zipResponseStream } from "./zipwriter.js";

function format(c: Context<AppEnv>): ExportFormat {
  const f = c.req.query("format") ?? "jsonld";
  if (!(exportFormats as readonly string[]).includes(f)) throw new ApiError(400, "invalid_query", "format must be jsonld or markdown");
  return f as ExportFormat;
}

async function opts(c: Context<AppEnv>) {
  const f = await c.get("flags").getFeatures();
  return { images: c.get("platform").images, householdId: c.get("householdId"), org: f.organizers.enabled, nutrition: f.nutrition.enabled };
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

/**
 * Household recipe export for any member, and single-recipe export. Mounted at /api/v1. Export is core, not
 * a feature flag, and it works on every platform (only instance backups depend on the embedded database).
 */
export const exportRoutes = new Hono<AppEnv>();
for (const p of ["/export/*", "/recipes/:slug/export"]) exportRoutes.use(p, requireAuth);

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
