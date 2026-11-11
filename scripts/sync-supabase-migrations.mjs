// Copies the drizzle migrations into supabase/migrations as <timestamp>_drizzle_<tag>.sql so `supabase db push`
// applies them. The copies are generated (gitignored); the drizzle folder stays the single source of truth.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function syncMigrations(srcDir = path.join(root, "apps/server/src/db/migrations"), destDir = path.join(root, "supabase/migrations")) {
  const journal = JSON.parse(fs.readFileSync(path.join(srcDir, "meta/_journal.json"), "utf8"));
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of fs.readdirSync(destDir)) if (/_drizzle_.*\.sql$/.test(f)) fs.rmSync(path.join(destDir, f));
  return journal.entries.map((e) => {
    const ts = new Date(e.when).toISOString().replace(/\D/g, "").slice(0, 14);
    const name = `${ts}_drizzle_${e.tag}.sql`;
    fs.copyFileSync(path.join(srcDir, `${e.tag}.sql`), path.join(destDir, name));
    return name;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) console.log(syncMigrations().join("\n"));
