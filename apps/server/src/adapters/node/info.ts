import fs from "node:fs";
import path from "node:path";
import type { PlatformInfo } from "../../ports/index.js";

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fs.promises.stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}

export async function nodeInfo(dataDir: string): Promise<PlatformInfo> {
  return {
    runtime: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    dbBytes: await dirSize(path.join(dataDir, "pgdata")),
    imagesBytes: await dirSize(path.join(dataDir, "images")),
    dataDir: path.resolve(dataDir),
  };
}
