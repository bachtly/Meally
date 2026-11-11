import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// webDist is resolved relative to the cwd, so keep it inside the package.
const dir = path.join(process.cwd(), ".tmp-share-preview");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-share-preview-"));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><head><title>Meally</title></head><body></body></html>");
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const H = { "content-type": "application/json", "x-requested-with": "meally" };

describe("share link pages on the Node server", () => {
  it("inject link-preview tags and Recipe JSON-LD into /s/* without counting a view", async () => {
    const app = createApp({ webDist: dir, dataDir, env: { MEALLY_SIGNUP_MODE: "open", BASE_URL: "https://meally.example" }, scryptLogN: 10 });
    const r = await app.request("/api/v1/auth/setup", { method: "POST", headers: H, body: JSON.stringify({ email: "a@example.com", name: "Ada", password: "correct horse" }) });
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    const call = (method: string, url: string, body?: unknown) =>
      app.request(`/api/v1${url}`, { method, headers: { ...H, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const { slug } = (await (await call("POST", "/recipes", { name: "Lemon cake", ingredients: [{ raw: "2 cups flour" }], steps: [{ text: "Mix." }] })).json()) as { slug: string };
    const { url } = (await (await call("POST", `/recipes/${slug}/shares`, { note: "Try it" })).json()) as { url: string };
    const sharePath = new URL(url).pathname;

    const res = await app.request(sharePath);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await res.text();
    expect(html).toContain("<title>Lemon cake · Meally</title>");
    expect(html).toContain('<meta property="og:description" content="Shared by Ada · Try it" />');
    expect(html).toContain(`<meta property="og:url" content="https://meally.example${sharePath}" />`);
    expect(html).toContain('"@type":"Recipe"');
    expect(html).toContain('"recipeIngredient":["2 cups flour"]');
    // The meta endpoint is public too, and neither counts a view (chat apps fetch previews on their own).
    expect((await app.request(`/api/v1/public/shares/${sharePath.split("/")[2]}/meta`)).status).toBe(200);
    const [link] = ((await (await call("GET", "/shares")).json()) as { items: { viewCount: number }[] }).items;
    expect(link!.viewCount).toBe(0);

    // A dead link still gets the app, just without tags; other routes are untouched.
    const dead = await (await app.request("/s/nonsense")).text();
    expect(dead).not.toContain("og:title");
    expect(dead).toContain("<title>Meally</title>");
    expect(await (await app.request("/recipes")).text()).not.toContain("og:title");
  });
});
