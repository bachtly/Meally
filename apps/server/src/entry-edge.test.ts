import { afterAll, describe, expect, it } from "vitest";
import { createEdgeApp, normalizeBasePath } from "./entry-edge.js";
import { sql } from "drizzle-orm";
import { createEdgePlatform } from "./adapters/edge/index.js";
import { rowsOf } from "./db/core.js";
import { openTestDb } from "./db/testing.js";

const h = openTestDb();
afterAll(() => h.close());

describe("edge entry", () => {
  it("normalizes the base path", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("meally/")).toBe("/meally");
    expect(normalizeBasePath("/meally")).toBe("/meally");
  });

  it("serves health and auth status under MEALLY_BASE_PATH with PBKDF2", async () => {
    await h.ready;
    const app = createEdgeApp({ MEALLY_BASE_PATH: "/meally", MEALLY_PBKDF2_ITERATIONS: "2000", MEALLY_SIGNUP_MODE: "open" }, h.db);
    const health = await app.request("/meally/api/v1/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });
    expect((await app.request("/api/v1/health")).status).toBe(404);
    const status = await app.request("/meally/api/v1/auth/status");
    expect(status.status).toBe(200);

    const post = (path: string, body: unknown) =>
      app.request(`/meally${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "meally" },
        body: JSON.stringify(body),
      });
    const setup = await post("/api/v1/auth/setup", { email: "e@example.com", name: "E", password: "long-enough-password" });
    expect(setup.status).toBe(201);
    const login = await post("/api/v1/auth/login", { email: "e@example.com", password: "long-enough-password" });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("meally");
    // The stored hash is PBKDF2 at the configured cost.
    const rows = await h.db.execute(sql`SELECT password_hash FROM users`);
    expect(rowsOf<{ password_hash: string }>(rows)[0]!.password_hash).toMatch(/^pbkdf2-sha256\$2000\$/);
  });

  it("has an image store that says not_configured and an events stub without streaming", async () => {
    const p = createEdgePlatform();
    await expect(p.images.get("h", "i", 320)).rejects.toMatchObject({ code: "not_configured" });
    await expect(p.images.putOriginal("h", new Uint8Array())).rejects.toMatchObject({ code: "not_configured" });
    expect(p.events.supportsStreaming).toBe(false);
    let ran = 0;
    p.scheduler.define("j", () => void ran++);
    p.scheduler.every("j", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toBe(0);
    await p.scheduler.runJob("j");
    expect(ran).toBe(1);
  });
});
