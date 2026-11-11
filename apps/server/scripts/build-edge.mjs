// Bundles src/entry-edge.ts into dist-edge/meally.js for Deno / Supabase Edge Functions.
// postgres-js stays an external `npm:` import (Deno resolves it natively); everything else is bundled.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pgVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies.postgres.replace(/^[^\d]*/, "");

export async function buildEdge({ outfile = path.join(root, "dist-edge/meally.js"), write = true } = {}) {
  return build({
    entryPoints: [path.join(root, "src/entry-edge.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    conditions: ["import", "module", "worker", "browser"],
    outfile,
    write,
    metafile: true,
    alias: { postgres: `npm:postgres@${pgVersion}` },
    external: ["npm:*", "node:crypto", "node:buffer"],
    inject: [path.join(root, "scripts/edge-shims.js")],
    logLevel: "warning",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await buildEdge();
  const out = Object.values(r.metafile.outputs)[0];
  console.log(`dist-edge/meally.js ${(out.bytes / 1024).toFixed(0)} KiB`);
}
