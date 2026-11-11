// Renders vercel.template.json -> vercel.json (gitignored) with the Supabase project ref.
// CLI: node scripts/render-vercel.mjs <template> <out> <ref>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function renderVercel(template, ref) {
  if (!/^[a-z0-9]{10,30}$/.test(ref ?? "")) throw new Error("SUPABASE_PROJECT_REF must be a 10-30 char lowercase id");
  return template.replaceAll("__SUPABASE_REF__", ref);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [tpl, out, ref] = process.argv.slice(2);
  fs.writeFileSync(out, renderVercel(fs.readFileSync(tpl, "utf8"), ref));
}
