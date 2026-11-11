import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

/** Code that is Node-only by nature (the process lock, restore CLI, zip/backups, upload temp files, DB file, static serving). */
const ALLOWED = [
  "adapters/node/",
  "features/backups/",
  "features/import-files/",
  "features/admin/routes.ts",
  "lib/lock.ts",
  "db/index.ts",
  "restore.ts",
  "app.ts",
];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("platform guard", () => {
  it("keeps node:fs and sharp out of services outside the Node adapters", () => {
    const bad = walk(root)
      .map((f) => path.relative(root, f).replaceAll("\\", "/"))
      .filter((f) => !f.endsWith(".test.ts") && !ALLOWED.some((a) => f.startsWith(a)))
      .filter((f) => /from\s+["'](node:fs(\/promises)?|fs|sharp)["']|import\(\s*["']sharp["']\s*\)/.test(fs.readFileSync(path.join(root, f), "utf8")));
    expect(bad).toEqual([]);
  });
});
