import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { openTestDb } from "../../db/testing.js";
import type { Fetcher } from "../import-url/fetch.js";
import { looseDuration } from "./importers.js";
import { openZip, safeEntryName } from "./zip.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-impfiles-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };
const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#33cc33" } }).png().toBuffer();

async function mk(env: Record<string, string> = {}, fetcher?: Fetcher) {
  const o = openTestDb();
  const app = createApp({ db: o.db, env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10, dataDir, ...(fetcher ? { fetcher } : {}) });
  await o.ready;
  const su = async (p: string, email: string) => {
    const r = await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name: "n", password: "correct horse" }) });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com");
  const B = await su("register", "b@example.com");
  const upload = (cookie: string, data: Uint8Array | string, filename: string) => {
    const form = new FormData();
    form.set("file", new Blob([data as never]), filename);
    return app.request("/api/v1/import/files", { method: "POST", headers: { "x-requested-with": "meally", cookie }, body: form });
  };
  const json = async (r: Response) => (await r.json()) as any;
  const get = (cookie: string, url: string) => app.request(`/api/v1${url}`, { headers: { ...H, cookie } });
  /** Uploads and waits for the job to finish. */
  const run = async (data: Uint8Array | string, filename: string, cookie = A) => {
    const r = await upload(cookie, data, filename);
    expect(r.status).toBe(202);
    const { id } = await json(r);
    for (let i = 0; i < 200; i++) {
      const j = await json(await get(cookie, `/import/jobs/${id}`));
      if (j.status === "done" || j.status === "failed") return j;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error("job did not finish");
  };
  const recipes = async (cookie = A) => (await json(await get(cookie, "/recipes?limit=100"))).items as any[];
  return { app, o, A, B, upload, run, get, json, recipes };
}

const ld = (name: string, extra: object = {}) => ({
  "@context": "https://schema.org",
  "@type": "Recipe",
  name,
  recipeIngredient: ["2 cups flour", "1 tsp salt"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Mix." }, { "@type": "HowToStep", text: "Bake." }],
  recipeYield: "4 servings",
  totalTime: "PT45M",
  keywords: "bread, easy",
  recipeCategory: "Baking",
  url: `https://example.com/${name.replaceAll(" ", "-")}`,
  ...extra,
});
const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));

const paprika = (name: string, extra: object = {}) =>
  gzipSync(
    JSON.stringify({
      name,
      ingredients: "For the dough:\n2 cups flour\n1 tsp salt",
      directions: "Mix it.\nBake it.",
      source_url: "https://paprika.example/x",
      servings: "6 servings",
      prep_time: "10 min",
      cook_time: "1 hr 5 min",
      categories: ["Dinner"],
      notes: "Good warm",
      photo_data: png.toString("base64"),
      ...extra,
    }),
  );

describe("import files", () => {
  it("imports a JSON-LD array (RecipeSage style) with tags and categories", async () => {
    const { run, recipes } = await mk();
    const j = await run(JSON.stringify([ld("Bread"), ld("Rolls")]), "export.json");
    expect(j).toMatchObject({ format: "jsonld", status: "done", total: 2, imported: 2, skipped: 0, failed: 0 });
    const list = await recipes();
    expect(list.map((r) => r.name).sort()).toEqual(["Bread", "Rolls"]);
  });

  it("maps fields of a single JSON-LD recipe", async () => {
    const { run, get, json, recipes, A } = await mk();
    await run(JSON.stringify(ld("Bread")), "one.json");
    const [r] = await recipes();
    const d = await json(await get(A, `/recipes/${r.slug}`));
    expect(d.ingredients[0]).toMatchObject({ quantity: 2, unit: "cup", food: "flour" });
    expect(d.steps.map((s: any) => s.text)).toEqual(["Mix.", "Bake."]);
    expect(d.totalMinutes).toBe(45);
    expect(d.servings).toBe(4);
    expect(d.sourceUrl).toBe("https://example.com/Bread");
    expect(d.tags.map((t: any) => t.name)).toEqual(["bread", "easy"]);
    expect(d.categories.map((t: any) => t.name)).toEqual(["Baking"]);
  });

  it("imports Paprika recipes with sections, times and photo", async () => {
    const { run, get, json, recipes, A } = await mk();
    const file = zip({ "Pie.paprikarecipe": paprika("Pie"), "Cake.paprikarecipe": paprika("Cake", { photo_data: "" }) });
    const j = await run(file, "all.paprikarecipes");
    expect(j).toMatchObject({ format: "paprika", status: "done", imported: 2 });
    const pie = (await recipes()).find((r) => r.name === "Pie");
    const d = await json(await get(A, `/recipes/${pie.slug}`));
    expect(d.ingredients[0]).toMatchObject({ section: "For the dough", quantity: 2, unit: "cup" });
    expect(d.steps).toHaveLength(2);
    expect(d.prepMinutes).toBe(10);
    expect(d.cookMinutes).toBe(65);
    expect(d.servings).toBe(6);
    expect(d.sourceUrl).toBe("https://paprika.example/x");
    expect(d.notes).toBe("Good warm");
    expect(d.imageUrl).toMatch(/^\/api\/v1\/images\//);
    expect(d.categories.map((c: any) => c.name)).toEqual(["Dinner"]);
  });

  it("imports a Mealie export zip", async () => {
    const { run, get, json, recipes, A } = await mk();
    const m = {
      name: "Mealie Stew",
      description: "Hearty",
      recipeYield: "4 servings",
      prepTime: "10 minutes",
      performTime: "1 hour 30 minutes",
      totalTime: null,
      orgURL: "https://m.example/stew",
      recipeIngredient: [
        { title: "Base", originalText: "1 onion, diced" },
        { quantity: 2, unit: { name: "cups" }, food: { name: "stock" }, note: "" },
      ],
      recipeInstructions: [{ title: "Cook", text: "Fry onion." }, { title: "", text: "Add stock." }],
      tags: [{ name: "winter" }],
      recipeCategory: [{ name: "Soup" }],
    };
    const j = await run(
      zip({ "recipes/mealie-stew/mealie-stew.json": JSON.stringify(m), "recipes/mealie-stew/images/original.webp": png, "database.json": "{}" }),
      "mealie_backup.zip",
    );
    expect(j).toMatchObject({ format: "mealie", status: "done", imported: 1 });
    const [r] = await recipes();
    const d = await json(await get(A, `/recipes/${r.slug}`));
    expect(d.ingredients).toHaveLength(2);
    expect(d.ingredients[0].section).toBe("Base");
    expect(d.steps.map((s: any) => s.section)).toEqual(["Cook", "Cook"]);
    expect(d.prepMinutes).toBe(10);
    expect(d.cookMinutes).toBe(90);
    expect(d.tags.map((t: any) => t.name)).toEqual(["winter"]);
    expect(d.categories.map((t: any) => t.name)).toEqual(["Soup"]);
    expect(d.imageUrl).toBeTruthy();
  });

  it("imports a zip of html and json files, reporting unreadable ones", async () => {
    const { run, recipes } = await mk();
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld("Html Soup"))}</script></head></html>`;
    const j = await run(zip({ "a/soup.html": html, "b.json": JSON.stringify(ld("Json Soup")), "c.html": "<p>nothing</p>", "d.txt": "x" }), "pages.zip");
    expect(j).toMatchObject({ format: "zip", status: "done", imported: 2, failed: 1 });
    expect(j.errors[0]).toMatchObject({ item: "c.html" });
    expect((await recipes()).map((r) => r.name).sort()).toEqual(["Html Soup", "Json Soup"]);
  });

  it("skips duplicates with the same name and source URL, counting them as skipped", async () => {
    const { run, recipes } = await mk();
    await run(JSON.stringify([ld("Bread")]), "a.json");
    const j = await run(JSON.stringify([ld("Bread"), ld("Bread", { url: "https://other.example/bread" })]), "b.json");
    expect(j).toMatchObject({ imported: 1, skipped: 1 });
    expect(await recipes()).toHaveLength(2);
  });

  it("rejects unsupported content up front", async () => {
    const { upload, A } = await mk();
    expect((await upload(A, "not json at all", "x.txt")).status).toBe(415);
    expect((await upload(A, JSON.stringify({ hello: 1 }), "x.json")).status).toBe(422);
    expect((await upload(A, zip({ "readme.txt": "hi" }), "x.zip")).status).toBe(415);
  });

  it("rejects path traversal and too many entries", async () => {
    const { upload, A } = await mk();
    expect((await upload(A, zip({ "../evil.json": JSON.stringify(ld("X")) }), "x.zip")).status).toBe(400);
    expect((await upload(A, zip({ "/abs.json": "{}" }), "x.zip")).status).toBe(400);
    const many: Record<string, string> = {};
    for (let i = 0; i < 5001; i++) many[`f${i}.json`] = "{}";
    expect((await upload(A, zip(many), "x.zip")).status).toBe(400);
  });

  it("rejects a zip bomb by total uncompressed size", async () => {
    const big = new Uint8Array(110 * 1024 * 1024);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5; i++) files[`z${i}.json`] = big;
    const f = path.join(dataDir, "bomb.zip");
    fs.writeFileSync(f, zipSync(files, { level: 1 }));
    await expect(openZip(f)).rejects.toMatchObject({ status: 400 });
    expect(() => safeEntryName("a\\..\\b")).toThrow();
    expect(safeEntryName("a/b.json")).toBe("a/b.json");
  }, 60_000);

  it("keeps jobs private to the user", async () => {
    const { run, get, B } = await mk();
    const j = await run(JSON.stringify(ld("Bread")), "a.json");
    expect((await get(B, `/import/jobs/${j.id}`)).status).toBe(404);
    expect(((await (await get(B, "/import/jobs")).json()) as any).items).toHaveLength(0);
  });

  it("lists recent jobs and caps stored errors at 100", async () => {
    const { run, get, json, A } = await mk();
    const files: Record<string, string> = {};
    for (let i = 0; i < 120; i++) files[`p${i}.html`] = "<p>no</p>";
    const j = await run(zip(files), "bad.zip");
    expect(j.failed).toBe(120);
    expect(j.errors).toHaveLength(100);
    expect((await json(await get(A, "/import/jobs"))).items).toHaveLength(1);
  });

  it("requires auth and the flag", async () => {
    const { app, upload, A } = await mk({ MEALLY_FEATURE_IMPORT_FILES: "off" });
    expect((await app.request("/api/v1/import/jobs", { headers: H })).status).toBe(401);
    expect((await upload(A, JSON.stringify(ld("Bread")), "a.json")).status).toBe(404);
  });

  it("parses loose durations", () => {
    expect(looseDuration("1 hr 15 min")).toBe(75);
    expect(looseDuration("PT1H")).toBe(60);
    expect(looseDuration("45 minutes")).toBe(45);
    expect(looseDuration("soon")).toBeNull();
  });

  describe("RecipeSage export", () => {
    const fixture = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "recipesage-export.json"), "utf8");
    const fetcher = (): Fetcher & { calls: string[] } => {
      const calls: string[] = [];
      const f = (async (url: string) => {
        calls.push(url);
        if (url.includes("second")) throw new Error("must not be fetched");
        return { body: png, contentType: "image/png", finalUrl: url };
      }) as unknown as Fetcher & { calls: string[] };
      f.calls = calls;
      return f;
    };

    it("detects the format and maps fields, labels, notes, rating, sections and images", async () => {
      const f = fetcher();
      const { run, get, json, recipes, A } = await mk({}, f);
      const j = await run(fixture, "recipesage.json");
      expect(j).toMatchObject({ format: "recipesage", status: "done", total: 3, imported: 3, failed: 0 });
      const by = Object.fromEntries((await recipes()).map((r) => [r.name, r]));
      const d = await json(await get(A, `/recipes/${by["Lemon Barley Salad"].slug}`));
      expect(d).toMatchObject({ servings: 4, prepMinutes: 15, totalMinutes: 65, sourceUrl: "https://blog.example.test/lemon-barley" });
      expect(d.me.rating).toBe(4);
      expect(d.tags.map((t: any) => t.name).sort()).toEqual(["Make ahead", "Salads"]);
      expect(d.notes).toBe("Better the next day.\n\nSource: Aunt Pim");
      expect(d.ingredients.map((i: any) => [i.section, i.food])).toEqual([
        ["Salad", "pearl barley"],
        ["Salad", "olive oil"],
        ["Dressing", "lemon"],
        ["Dressing", "honey"],
      ]);
      expect(d.steps.map((s: any) => s.section)).toEqual(["Cook the barley", "Cook the barley", "Dress it"]);
      expect(d.imageUrl).toBeTruthy();
      // Only the first image URL is fetched.
      expect(f.calls).toEqual(["https://img.example.test/lemon-barley.jpg"]);
      // Free-text times, inline data-URI image, credit without a link.
      const toast = await json(await get(A, `/recipes/${by["Plain Toast"].slug}`));
      expect(toast).toMatchObject({ prepMinutes: 5, totalMinutes: 10, notes: "Source: Grandma" });
      expect(toast.imageUrl).toBeTruthy();
      expect(toast.tags).toEqual([]);
    });

    it("keeps the recipe when an image download fails, and skips duplicates on re-import", async () => {
      const bad: Fetcher = async () => {
        throw new Error("down");
      };
      const { run, recipes } = await mk({}, bad);
      const j = await run(fixture, "recipesage.json");
      expect(j).toMatchObject({ imported: 3, failed: 0 });
      const again = await run(fixture, "recipesage.json");
      expect(again).toMatchObject({ imported: 0, skipped: 3 });
      expect(await recipes()).toHaveLength(3);
    });

    it("puts the rating in notes when the ratings flag is off", async () => {
      const { run, get, json, recipes, A } = await mk({ MEALLY_FEATURE_RATINGS: "off" }, fetcher());
      await run(fixture, "recipesage.json");
      const r = (await recipes()).find((x) => x.name === "Pantry Soup");
      const d = await json(await get(A, `/recipes/${r.slug}`));
      expect(d.notes).toBe("Rating in source: 3/5");
      expect(d.me?.rating ?? null).toBeNull();
    });
  });
});
