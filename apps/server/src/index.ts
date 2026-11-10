import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp, version } from "./app.js";
import { config } from "./lib/config.js";
import { createDb } from "./db/index.js";
import { createFlagsService } from "./features/features/service.js";
import { backupSettings, startBackupScheduler } from "./features/backups/service.js";
import { acquireLock } from "./lib/lock.js";

acquireLock(config.DATA_DIR);

const { db } = await createDb(path.join(config.DATA_DIR, "meally.db"));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist =
  config.NODE_ENV === "production" ? (process.env.WEB_DIST ?? path.resolve(here, "../../web/dist")) : undefined;

const flags = createFlagsService(db, process.env);
startBackupScheduler({
  db,
  dataDir: config.DATA_DIR,
  version,
  settings: backupSettings(process.env),
  enabled: async () => (await flags.getFeatures()).backups.enabled,
});

serve({ fetch: createApp({ webDist, db, flags }).fetch, port: config.PORT }, (info) => {
  console.log(`Meally listening on :${info.port}`);
});
