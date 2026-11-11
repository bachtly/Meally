import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { ApiError } from "../../lib/errors.js";
import type { Fetcher } from "./fetch.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-import-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const fx = (n: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", n));
const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#cc3333" } }).png().toBuffer();

const fetcher: Fetcher = vi.fn(async (url, { kind }) => {
  if (url.includes("blocked")) throw new ApiError(400, "blocked_url", "no");
  if (url.includes("down")) throw new ApiError(502, "fetch_failed", "no");
  if (kind === "image") return { body: png, contentType: "image/png", finalUrl: url };
  const file = url.includes("none") ? "none.html" : "graph.html";
  return { body: fx(file), contentType: "text/html", finalUrl: url };
});
const app = createApp({ env: { MEALLY_SIGNUP_MODE: "open" }, scryptLogN: 10, dataDir, fetcher });
const H = { "content-type": "application/json", "x-requested-with": "meally" };
const res = await app.request("/api/v1/auth/setup", { method: "POST", headers: H, body: JSON.stringify({ email: "a@example.com", name: "a", password: "correct horse" }) });
const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
const post = (p: string, url: string) => app.request(`/api/v1/import/url${p}`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ url }) });

describe("import url routes", () => {
  it("requires auth", async () => {
    expect((await app.request("/api/v1/import/url", { method: "POST", headers: H, body: "{}" })).status).toBe(401);
  });
  it("previews without saving", async () => {
    const r = await post("/preview", "https://example.com/soup");
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).recipe.name).toBe("Tomato & Basil Soup");
    const list = await app.request("/api/v1/recipes", { headers: { ...H, cookie } });
    expect(((await list.json()) as any).items).toHaveLength(0);
  });
  it("imports a recipe with its image", async () => {
    const r = await post("", "https://example.com/soup");
    expect(r.status).toBe(201);
    const { slug } = (await r.json()) as any;
    const rec = (await (await app.request(`/api/v1/recipes/${slug}`, { headers: { ...H, cookie } })).json()) as any;
    expect(rec.ingredients).toHaveLength(3);
    expect(rec.sourceUrl).toBe("https://example.com/soup");
    expect(rec.imageUrl).toMatch(/^\/api\/v1\/images\//);
  });
  it("saves keywords and categories as tags and categories", async () => {
    const { slug } = (await (await post("", "https://example.com/soup2")).json()) as any;
    const rec = (await (await app.request(`/api/v1/recipes/${slug}`, { headers: { ...H, cookie } })).json()) as any;
    expect(rec.tags.length).toBeGreaterThan(0);
    expect(rec.tags.length).toBeLessThanOrEqual(10);
  });
  it("maps errors", async () => {
    expect((await post("", "https://example.com/none")).status).toBe(422);
    expect((await post("", "https://blocked.example/")).status).toBe(400);
    expect((await post("", "https://down.example/")).status).toBe(502);
    expect((await post("", "")).status).toBe(400);
  });
  it("rate limits at 20 per hour per user", async () => {
    let last = 0;
    for (let i = 0; i < 20; i++) last = (await post("/preview", "https://example.com/soup")).status;
    expect(last).toBe(429);
  });
});
