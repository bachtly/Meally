import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./lib/config.js";
import { createDb } from "./db/index.js";

const { db } = await createDb(path.join(config.DATA_DIR, "meally.db"));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist =
  config.NODE_ENV === "production" ? (process.env.WEB_DIST ?? path.resolve(here, "../../web/dist")) : undefined;

serve({ fetch: createApp({ webDist, db }).fetch, port: config.PORT }, (info) => {
  console.log(`Meally listening on :${info.port}`);
});
