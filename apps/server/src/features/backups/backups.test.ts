import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { openDb } from "../../db/index.js";
import { recipes } from "../../db/schema/index.js";
import { openTestDb } from "../../db/testing.js";
import { restore } from "../../restore.js";
import { isLocked, lockPath } from "../../lib/lock.js";
import { backupSettings, createBackup, listBackups, pruneBackups, validBackupName } from "./service.js";
import { toMarkdown } from "./export.js";

const tmpDirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "meally-backup-"));
  tmpDirs.push(d);
  return d;
};
afterAll(() => tmpDirs.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold a sqlite handle; the OS temp dir is cleaned later */ } }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };
const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#33cc33" } }).png().toBuffer();

async function mk(env: Record<string, string> = {}) {
  const dataDir = tmp();
  const o = openTestDb({ pglite: true });
  const app = createApp({ db: o.db, env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10, dataDir });
  await o.ready;
  const su = async (p: string, email: string) => {
    const r = await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name: "n", password: "correct horse" }) });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com"); // admin
  const B = await su("register", "b@example.com"); // other user, not admin
  const req = (cookie: string, url: string, method = "GET", body?: unknown) =>
    app.request(`/api/v1${url}`, { method, headers: { ...H, cookie }, body: body ? JSON.stringify(body) : undefined });
  const json = async (r: Response) => (await r.json()) as any;
  const recipe = async (cookie: string, name: string, extra: object = {}) => {
    const r = await req(cookie, "/recipes", "POST", {
      name,
      description: "Tasty",
      servings: 4,
      yieldText: "4 servings",
      totalMinutes: 45,
      prepMinutes: 15,
      ingredients: [{ raw: "2 cups flour" }, { raw: "1 tsp salt" }],
      steps: [{ text: "Mix." }, { text: "Bake." }],
      ...extra,
    });
    expect(r.status).toBe(201);
    return json(r);
  };
  const zipOf = async (r: Response) => unzipSync(new Uint8Array(await r.arrayBuffer()));
  return { app, o, dataDir, A, B, req, json, recipe, zipOf };
}

describe("export", () => {
  it("zips one JSON-LD file per recipe plus images, for the caller only", async () => {
    const t = await mk();
    const r1 = await t.recipe(t.A, "Bread");
    await t.recipe(t.A, "Soup");
    await t.recipe(t.B, "Secret");
    const form = new FormData();
    form.set("file", new Blob([png as never], { type: "image/png" }), "x.png");
    const up = await t.app.request(`/api/v1/recipes/${r1.slug}/image`, { method: "POST", headers: { "x-requested-with": "meally", cookie: t.A }, body: form });
    expect(up.status).toBeLessThan(300);

    const res = await t.req(t.A, "/export/recipes?format=jsonld");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const files = await t.zipOf(res);
    expect(Object.keys(files).sort()).toEqual(["images/bread.webp", "recipes/bread.json", "recipes/soup.json"]);
    const node = JSON.parse(strFromU8(files["recipes/bread.json"]!));
    expect(node).toMatchObject({ "@type": "Recipe", name: "Bread", image: "images/bread.webp", totalTime: "PT45M", recipeIngredient: ["2 cups flour", "1 tsp salt"] });
  });

  it("writes markdown with front matter", async () => {
    const t = await mk();
    await t.recipe(t.A, "Bread", { sourceUrl: "https://example.com/b", ingredients: [{ raw: "2 cups flour", section: "Dough" }] });
    const files = await t.zipOf(await t.req(t.A, "/export/recipes?format=markdown"));
    const md = strFromU8(files["recipes/bread.md"]!);
    expect(md.startsWith('---\ntitle: "Bread"\n')).toBe(true);
    expect(md).toContain('source: "https://example.com/b"');
    expect(md).toContain("### Dough\n\n- 2 cups flour");
    expect(md).toContain("1. Mix.\n2. Bake.");
  });

  it("escapes awkward titles in front matter", () => {
    const md = toMarkdown({ name: 'He said "hi": ok', ingredients: [], steps: [], createdAt: 0, updatedAt: 0, slug: "x" } as never, null);
    expect(md).toContain('title: "He said \\"hi\\": ok"');
  });

  it("exports a single recipe, 404s across users, and rejects bad formats", async () => {
    const t = await mk();
    const r = await t.recipe(t.A, "Bread");
    const files = await t.zipOf(await t.req(t.A, `/recipes/${r.slug}/export?format=markdown`));
    expect(Object.keys(files)).toEqual(["recipes/bread.md"]);
    expect((await t.req(t.B, `/recipes/${r.slug}/export`)).status).toBe(404);
    expect((await t.req(t.A, "/export/recipes?format=pdf")).status).toBe(400);
    const anon = await t.app.request("/api/v1/export/recipes");
    expect(anon.status).toBe(401);
  });

  it("round-trips through the JSON-LD importer", async () => {
    const t = await mk();
    await t.recipe(t.A, "Bread", {
      tags: ["easy"],
      steps: [{ text: "Mix.", section: "Dough" }, { text: "Bake." }],
    });
    await t.recipe(t.A, "Soup", { sourceUrl: "https://example.com/soup" });
    const res = await t.req(t.A, "/export/recipes?format=jsonld");
    const form = new FormData();
    form.set("file", new Blob([await res.arrayBuffer()]), "export.zip");
    const up = await t.app.request("/api/v1/import/files", { method: "POST", headers: { "x-requested-with": "meally", cookie: t.B }, body: form });
    expect(up.status).toBe(202);
    const { id } = await t.json(up);
    let job: any;
    for (let i = 0; i < 200; i++) {
      job = await t.json(await t.req(t.B, `/import/jobs/${id}`));
      if (job.status === "done" || job.status === "failed") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job).toMatchObject({ status: "done", imported: 2, failed: 0 });
    const list = (await t.json(await t.req(t.B, "/recipes?limit=50"))).items as any[];
    expect(list.map((x) => x.name).sort()).toEqual(["Bread", "Soup"]);
    const bread = await t.json(await t.req(t.B, "/recipes/bread"));
    expect(bread).toMatchObject({ servings: 4, totalMinutes: 45, prepMinutes: 15, description: "Tasty" });
    expect(bread.ingredients.map((i: any) => i.raw)).toEqual(["2 cups flour", "1 tsp salt"]);
    expect(bread.steps.map((s: any) => s.text)).toEqual(["Mix.", "Bake."]);
    expect(bread.steps[0].section).toBe("Dough");
  });

  it("stays available when the backups flag is off; only instance backups are hidden", async () => {
    const t = await mk({ MEALLY_FEATURE_BACKUPS: "off" });
    expect((await t.req(t.A, "/export/recipes")).status).toBe(200);
    expect((await t.req(t.A, "/admin/backups")).status).toBe(404);
  });
});

describe("backup names", () => {
  it("accepts only generated names", () => {
    expect(validBackupName("meally-20261111T120000123Z.zip")).toBe(true);
    for (const bad of ["../meally.db", "meally-20261111T120000123Z.zip/../x", "meally-1.zip", "x/meally-20261111T120000123Z.zip", "meally-20261111T120000123Z.zip.partial", "MEALLY-20261111T120000123Z.zip", "meally-20261111T120000123Z.zip\0", "..\\a.zip"])
      expect(validBackupName(bad)).toBe(false);
  });
});

describe("backup API", () => {
  it("is admin only", async () => {
    const t = await mk();
    // B is the a normal user, not an instance admin.
    expect((await t.req(t.B, "/admin/backups")).status).toBe(403);
    expect((await t.req(t.B, "/admin/backups", "POST")).status).toBe(403);
    expect((await t.req(t.B, "/admin/backups/meally-20261111T120000123Z.zip", "DELETE")).status).toBe(403);
  });

  it("creates, lists, downloads and deletes; rejects bad names", async () => {
    const t = await mk({ MEALLY_BACKUP_KEEP: "3" });
    await t.recipe(t.A, "Bread");
    const made = await t.req(t.A, "/admin/backups", "POST");
    expect(made.status).toBe(201);
    const { name } = await t.json(made);
    expect(validBackupName(name)).toBe(true);

    const list = await t.json(await t.req(t.A, "/admin/backups"));
    expect(list.items.map((i: any) => i.name)).toEqual([name]);
    expect(list.schedule).toEqual({ hours: 24, keep: 3 });

    const dl = await t.req(t.A, `/admin/backups/${name}`);
    expect(dl.status).toBe(200);
    const files = await t.zipOf(dl);
    expect(Object.keys(files).sort()).toEqual(["manifest.json", "pgdata.tar.gz"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest).toMatchObject({ format: 1, appVersion: "0.0.0" });
    expect(manifest.schemaMigrations).toBeGreaterThanOrEqual(2);
    expect(files["pgdata.tar.gz"]!.length).toBeGreaterThan(4096);
    expect([...files["pgdata.tar.gz"]!.slice(0, 2)]).toEqual([0x1f, 0x8b]); // gzip

    expect((await t.req(t.A, "/admin/backups/..%2Fmeally.db")).status).toBe(404);
    expect((await t.req(t.A, "/admin/backups/nope.zip")).status).toBe(404);
    expect((await t.req(t.A, "/admin/backups/meally-20200101T000000000Z.zip")).status).toBe(404);
    expect((await t.req(t.A, `/admin/backups/${name}`, "DELETE")).status).toBe(204);
    expect((await t.req(t.A, `/admin/backups/${name}`, "DELETE")).status).toBe(404);
  });

  it("includes the images directory", async () => {
    const t = await mk();
    const r = await t.recipe(t.A, "Bread");
    const form = new FormData();
    form.set("file", new Blob([png as never], { type: "image/png" }), "x.png");
    await t.app.request(`/api/v1/recipes/${r.slug}/image`, { method: "POST", headers: { "x-requested-with": "meally", cookie: t.A }, body: form });
    const { name } = await t.json(await t.req(t.A, "/admin/backups", "POST"));
    const files = await t.zipOf(await t.req(t.A, `/admin/backups/${name}`));
    expect(Object.keys(files).filter((k) => k.startsWith("images/") && k.endsWith(".webp")).length).toBe(3);
  });
});

describe("retention and settings", () => {
  it("prunes the oldest beyond keep", async () => {
    const t = await mk();
    for (let i = 1; i <= 4; i++) await createBackup(t.o.db, t.dataDir, "0.0.0", 2, new Date(Date.UTC(2026, 0, i)));
    const names = (await listBackups(t.dataDir)).map((b) => b.name);
    expect(names).toEqual(["meally-20260104T000000000Z.zip", "meally-20260103T000000000Z.zip"]);
    expect(await pruneBackups(t.dataDir, 1)).toEqual(["meally-20260103T000000000Z.zip"]);
    expect(await pruneBackups(t.dataDir, 0)).toEqual([]); // never deletes the last one
  });

  it("reads schedule defaults and 0 = off", () => {
    expect(backupSettings({})).toEqual({ hours: 24, keep: 7 });
    expect(backupSettings({ MEALLY_BACKUP_CRON_HOURS: "0", MEALLY_BACKUP_KEEP: "2" })).toEqual({ hours: 0, keep: 2 });
    expect(backupSettings({ MEALLY_BACKUP_CRON_HOURS: "abc", MEALLY_BACKUP_KEEP: "-1" })).toEqual({ hours: 0, keep: 7 });
  });
});

describe("restore CLI", () => {
  it("restores into a temp dir, moving the old data aside", async () => {
    const t = await mk();
    const r = await t.recipe(t.A, "Bread");
    const form = new FormData();
    form.set("file", new Blob([png as never], { type: "image/png" }), "x.png");
    await t.app.request(`/api/v1/recipes/${r.slug}/image`, { method: "POST", headers: { "x-requested-with": "meally", cookie: t.A }, body: form });
    const { name } = await t.json(await t.req(t.A, "/admin/backups", "POST"));
    const zipFile = path.join(t.dataDir, "backups", name);

    const target = tmp();
    fs.mkdirSync(path.join(target, "pgdata"));
    fs.writeFileSync(path.join(target, "pgdata", "old.txt"), "old data");
    fs.mkdirSync(path.join(target, "images"));
    fs.writeFileSync(path.join(target, "images", "old.webp"), "x");
    const res = await restore(zipFile, target);
    expect(fs.readFileSync(path.join(res.movedTo, "pgdata", "old.txt"), "utf8")).toBe("old data");
    expect(fs.existsSync(path.join(res.movedTo, "images", "old.webp"))).toBe(true);
    expect(fs.existsSync(path.join(target, "pgdata", "PG_VERSION"))).toBe(true);
    expect(fs.existsSync(path.join(target, "images", "old.webp"))).toBe(false);
    expect(fs.readdirSync(path.join(target, "images")).length).toBe(1); // the user dir

    // The restored database opens and holds the recipe.
    const o = openDb(path.join(target, "pgdata"));
    await o.ready;
    const rows = await o.db.select({ name: recipes.name }).from(recipes);
    expect(rows.map((x) => x.name)).toEqual(["Bread"]);
    await o.close();
  });

  it("refuses while the server lock is held by a live process, unless forced", async () => {
    const t = await mk();
    await t.req(t.A, "/admin/backups", "POST");
    const [b] = await listBackups(t.dataDir);
    const zipFile = path.join(t.dataDir, "backups", b!.name);
    const target = tmp();
    fs.writeFileSync(lockPath(target), String(process.ppid));
    expect(isLocked(target)).toBe(true);
    await expect(restore(zipFile, target)).rejects.toThrow(/running/);
    await restore(zipFile, target, { force: true });
    fs.writeFileSync(lockPath(target), "99999999"); // stale
    expect(isLocked(target)).toBe(false);
  });

  it("rejects a backup from a newer schema, a missing manifest and unsafe paths", async () => {
    const t = await mk();
    await t.req(t.A, "/admin/backups", "POST");
    const [b] = await listBackups(t.dataDir);
    const zipFile = path.join(t.dataDir, "backups", b!.name);
    await expect(restore(zipFile, tmp(), { knownMigrations: 1 })).rejects.toThrow(/newer Meally/);

    const { zipSync, strToU8 } = await import("fflate");
    const noManifest = path.join(tmp(), "a.zip");
    fs.writeFileSync(noManifest, zipSync({ "pgdata.tar.gz": strToU8("x") }));
    await expect(restore(noManifest, tmp())).rejects.toThrow(/manifest/);

    const evil = path.join(tmp(), "b.zip");
    const m = JSON.stringify({ format: 1, appVersion: "0", schemaMigrations: 1, createdAt: "x" });
    fs.writeFileSync(evil, zipSync({ "manifest.json": strToU8(m), "pgdata.tar.gz": strToU8("x"), "images/../../evil": strToU8("x") }));
    const target = tmp();
    await expect(restore(evil, target, { knownMigrations: 5 })).rejects.toThrow(/unsafe|invalid relative path/);
    expect(fs.readdirSync(target)).toEqual([]); // nothing moved before validation
  });
});
