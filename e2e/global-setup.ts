import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { root, setupAdmin, startServer } from "./server";

/** Builds the app unless a build exists (set E2E_BUILD=1 to force), then starts the shared server. */
export default async function globalSetup() {
  const built = fs.existsSync(path.join(root, "apps/server/dist/index.js")) && fs.existsSync(path.join(root, "apps/web/dist/index.html"));
  if (!built || process.env.E2E_BUILD === "1") {
    const r = spawnSync("npm run build", { cwd: root, stdio: "inherit", shell: true });
    if (r.status !== 0) throw new Error("npm run build failed");
  }
  const server = await startServer();
  process.env.E2E_BASE_URL = server.url;
  process.env.E2E_COOKIE = await setupAdmin(server.url);
  return async () => {
    await server.stop();
  };
}
