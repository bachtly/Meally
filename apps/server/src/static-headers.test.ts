import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const dir = path.join(process.cwd(), ".tmp-static-headers");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
fs.writeFileSync(path.join(dir, "sw.js"), "//sw");
fs.writeFileSync(path.join(dir, "manifest.webmanifest"), "{}");
fs.writeFileSync(path.join(dir, "workbox-abc123.js"), "//wb");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("PWA static headers", () => {
  const app = createApp({ webDist: dir });
  it("serves sw.js and the manifest with no-cache", async () => {
    for (const p of ["/sw.js", "/manifest.webmanifest"]) {
      const res = await app.request(p);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
    expect((await app.request("/sw.js")).headers.get("content-type")).toMatch(/javascript/);
  });
  it("caches hashed workbox chunks long-term", async () => {
    expect((await app.request("/workbox-abc123.js")).headers.get("cache-control")).toMatch(/immutable/);
  });
});
