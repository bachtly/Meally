import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp, version } from "./app.js";
import { config } from "./lib/config.js";
import { createDb, dbTarget } from "./db/index.js";
import { createFlagsService } from "./features/features/service.js";
import { backupSettings, startBackupScheduler } from "./features/backups/service.js";
import { createNodePlatform } from "./adapters/node/index.js";
import { acquireLock } from "./lib/lock.js";

acquireLock(config.DATA_DIR);

const { db } = await createDb(dbTarget(config));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist =
  config.NODE_ENV === "production" ? (process.env.WEB_DIST ?? path.resolve(here, "../../web/dist")) : undefined;

// In-app backups snapshot the embedded database only; with DATABASE_URL use pg_dump instead.
const env = config.DATABASE_URL ? { ...process.env, MEALLY_FEATURE_BACKUPS: "false" } : process.env;
const flags = createFlagsService(db, env);
const platform = createNodePlatform({ dataDir: config.DATA_DIR });
startBackupScheduler({
  db,
  dataDir: config.DATA_DIR,
  version,
  settings: backupSettings(process.env),
  scheduler: platform.scheduler,
  enabled: async () => (await flags.getFeatures()).backups.enabled,
});

serve({ fetch: createApp({ webDist, db, flags, platform, dataDir: config.DATA_DIR, webhookScheduler: true }).fetch, port: config.PORT }, (info) => {
  console.log(`Meally listening on :${info.port}`);
});
