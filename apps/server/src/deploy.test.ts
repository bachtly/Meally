import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createEdgeApp, withPublicUrl } from "./entry-edge.js";
import { openTestDb } from "./db/testing.js";

const root = path.resolve(__dirname, "../../..");
const REF = "abcdefghijklmnopqrst";
const load = (f: string) => import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts", f)).href);

describe("vercel.json template", () => {
  it("renders the ref, keeps rewrite order and cache headers", async () => {
    const { renderVercel } = await load("render-vercel.mjs");
    const out = JSON.parse(renderVercel(fs.readFileSync(path.join(root, "vercel.template.json"), "utf8"), REF));
    expect(out.outputDirectory).toBe("apps/web/dist");
    expect(out.buildCommand).toBe("npm run build -w apps/web");
    expect(out.rewrites[0]).toEqual({ source: "/api/(.*)", destination: `https://${REF}.supabase.co/functions/v1/meally/api/$1` });
    expect(out.rewrites[1]).toEqual({ source: "/(.*)", destination: "/index.html" });
    expect(JSON.stringify(out.headers)).toContain("/sw.js");
    expect(JSON.stringify(out)).not.toContain("__SUPABASE_REF__");
    expect(() => renderVercel("x", "BAD ref")).toThrow();
  });
});

describe("migration sync", () => {
  it("copies drizzle migrations with timestamped names", async () => {
    const { syncMigrations } = await load("sync-supabase-migrations.mjs");
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
    const names: string[] = syncMigrations(path.join(root, "apps/server/src/db/migrations"), dest);
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names[0]).toMatch(/^\d{14}_drizzle_0000_/);
    expect([...names].sort()).toEqual(names);
  });
});

describe("deploy.sh --dry-run", () => {
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: "sbp_fake_secret", SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: "pw-fake-secret", VERCEL_TOKEN: "vc-fake-secret", JOB_SECRET: "job-fake-secret" };
  it("prints the plan, calls nothing and echoes no secret", () => {
    const r = spawnSync("bash", ["scripts/deploy.sh", "--dry-run"], { cwd: root, env, encoding: "utf8" });
    expect(r.status).toBe(0);
    const out = r.stdout.toLowerCase();
    for (const s of ["install and build", "link the supabase", "migrations", "vault", "function secrets", "edge function", "vercel", "smoke test"]) expect(out).toContain(s);
    expect(r.stdout).toContain("[dry-run]");
    expect(r.stdout + r.stderr).not.toMatch(/fake-secret/);
    expect(fs.existsSync(path.join(root, "vercel.json"))).toBe(false);
  });
  it("fails fast naming missing vars", () => {
    const r = spawnSync("bash", ["scripts/deploy.sh", "--dry-run"], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("SUPABASE_ACCESS_TOKEN");
  });
});

describe("CSRF behind the Vercel proxy", () => {
  const h = openTestDb();
  const PUBLIC = "https://meally.vercel.app";
  it("maps MEALLY_PUBLIC_URL to the cookie/CSRF origin", () => {
    expect(withPublicUrl({ MEALLY_PUBLIC_URL: PUBLIC }).BASE_URL).toBe(PUBLIC);
    expect(withPublicUrl({ BASE_URL: "http://x" }).BASE_URL).toBe("http://x");
  });
  it("accepts the public Origin and rejects a foreign one", async () => {
    await h.ready;
    const app = createEdgeApp({ MEALLY_BASE_PATH: "/meally", MEALLY_PBKDF2_ITERATIONS: "2000", MEALLY_PUBLIC_URL: PUBLIC }, h.db);
    const call = (origin: string) =>
      app.request("https://abc.supabase.co/meally/api/v1/auth/logout", { method: "POST", headers: { origin, cookie: "meally_session=x", "content-type": "application/json" } });
    expect((await call(PUBLIC)).status).not.toBe(403);
    expect((await call("https://evil.example")).status).toBe(403);
    await h.close();
  });
});
