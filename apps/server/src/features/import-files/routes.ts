import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { planImport } from "./importers.js";
import { createJob, enqueue, getJob, jobView, listJobs, runJob } from "./service.js";

export const MAX_UPLOAD = 200 * 1024 * 1024;

export const importFileRoutes = new Hono<AppEnv>();
importFileRoutes.use("*", requireAuth, requireFeature("import-files"));

/** Streams the first file part of a multipart body to a temp file, never holding it in memory. */
async function receive(c: Context<AppEnv>): Promise<{ file: string; filename: string }> {
  const type = c.req.header("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(type) || !c.req.raw.body) throw new ApiError(400, "invalid_body", "Send the file as multipart form data");
  const len = Number(c.req.header("content-length"));
  if (len > MAX_UPLOAD + 1024 * 1024) throw new ApiError(413, "too_large", "That file is over the 200 MB limit");
  const dir = path.join(c.get("dataDir"), "tmp");
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `import-${randomUUID()}`);
  let filename = "";
  let tooLarge = false;
  let writing: Promise<void> | null = null;
  const bb = busboy({ headers: { "content-type": type }, limits: { files: 1, fileSize: MAX_UPLOAD, fields: 5 } });
  bb.on("file", (_name, stream, info) => {
    if (writing) return void stream.resume();
    filename = path.basename(info.filename || "upload").slice(0, 200);
    stream.on("limit", () => (tooLarge = true));
    writing = pipeline(stream, fs.createWriteStream(file));
  });
  try {
    await pipeline(Readable.fromWeb(c.req.raw.body as never), bb);
    await writing;
  } catch (e) {
    await fs.promises.rm(file, { force: true });
    throw new ApiError(400, "invalid_body", e instanceof Error && !tooLarge ? "The upload could not be read" : "Upload failed");
  }
  if (tooLarge) {
    await fs.promises.rm(file, { force: true });
    throw new ApiError(413, "too_large", "That file is over the 200 MB limit");
  }
  if (!writing) throw new ApiError(400, "invalid_body", "No file was uploaded");
  return { file, filename };
}

importFileRoutes.post("/files", async (c) => {
  const { file, filename } = await receive(c);
  let plan;
  try {
    plan = await planImport(file, filename);
  } catch (e) {
    await fs.promises.rm(file, { force: true });
    throw e;
  }
  const db = c.get("db");
  const user = c.get("user");
  const householdId = c.get("householdId");
  const org = (await c.get("flags").getFeatures()).organizers.enabled;
  const nutrition = (await c.get("flags").getFeatures()).nutrition.enabled;
  const job = await createJob(db, householdId, user.id, plan.format, filename, plan.items.length);
  const dataDir = c.get("dataDir");
  // Fire and forget: the client polls GET /jobs/:id.
  void enqueue(() => runJob({ db, dataDir, householdId, userId: user.id, org, nutrition, jobId: job.id, file, plan }));
  return c.json(jobView(job), 202);
});

importFileRoutes.get("/jobs", async (c) => c.json({ items: (await listJobs(c.get("db"), c.get("householdId"))).map(jobView) }));
importFileRoutes.get("/jobs/:id", async (c) => c.json(jobView(await getJob(c.get("db"), c.get("householdId"), c.req.param("id")))));
