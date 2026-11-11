import { describe, expect, it } from "vitest";
import { createApp, version } from "./app.js";
import { createDb } from "./db/index.js";
import { appMeta } from "./db/schema/index.js";

describe("api", () => {
  it("GET /api/v1/health", async () => {
    const res = await createApp().request("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version });
  });

  it("unknown api route returns error json", async () => {
    const res = await createApp().request("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});

describe("db", () => {
  it("applies migrations", () => {
    const { db } = createDb(":memory:");
    db.insert(appMeta).values({ key: "k", value: "v" }).run();
    expect(db.select().from(appMeta).all()).toEqual([{ key: "k", value: "v" }]);
  });
});
