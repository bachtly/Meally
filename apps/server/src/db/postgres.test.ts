import { afterAll, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { isTransactionPooler, openPostgres } from "./postgres.js";
import { createCoreApp, NO_DEADLINE } from "../app-core.js";
import { createEdgePlatform } from "../adapters/edge/index.js";
import { openTestDb } from "./testing.js";

/** A stand-in postgres-js client: records its options and how it was ended. */
function fakeClient() {
  const made: { opts: Record<string, unknown>; end: ReturnType<typeof vi.fn> }[] = [];
  const connect = (_url: string, opts: Record<string, unknown>) => {
    const end = vi.fn(async () => {});
    made.push({ opts, end });
    // drizzle only needs `options.parsers/serializers` at construction; queries are not run here.
    return Object.assign(() => {}, { options: { parsers: {}, serializers: {} }, end }) as unknown as postgres.Sql;
  };
  return { made, connect };
}

describe("openPostgres", () => {
  it("uses a small pool with short timeouts, so a dead socket fails instead of hanging", () => {
    const { made, connect } = fakeClient();
    openPostgres("postgres://x", { connect: connect as never });
    expect(made[0]!.opts).toMatchObject({ prepare: false, max: 2, idle_timeout: 20, max_lifetime: 300, connect_timeout: 10 });
    expect(made[0]!.opts).not.toHaveProperty("max_pipeline"); // 0 would break sql.begin
  });

  it("flags the Supabase transaction pooler, which hangs on overlapping queries", () => {
    expect(isTransactionPooler("postgresql://u:p@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres")).toBe(true);
    expect(isTransactionPooler("postgresql://u:p@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres")).toBe(false);
    expect(isTransactionPooler("postgres://localhost:6543/x")).toBe(false);
    expect(isTransactionPooler("not a url")).toBe(false);
  });

  it("reset swaps in a fresh client behind the same db object and cancels the old one", () => {
    const { made, connect } = fakeClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = openPostgres("postgres://x", { connect: connect as never });
    const db = h.db;
    const before = db.select;
    h.reset("GET /x stalled");
    expect(made).toHaveLength(2);
    expect(made[0]!.end).toHaveBeenCalledWith({ timeout: 0 });
    expect(h.resets).toBe(1);
    expect(h.db).toBe(db); // holders of `db` keep the same object
    expect(db.select).not.toBe(before); // ...which now forwards to the new client
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GET /x stalled"));
    warn.mockRestore();
  });
});

describe("request deadline", () => {
  const h = openTestDb();
  afterAll(() => h.close());

  it("answers 503 and reports the stall instead of hanging", async () => {
    await h.ready;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onStall = vi.fn();
    const app = createCoreApp({
      db: h.db,
      env: { BASE_URL: "http://localhost" },
      platform: createEdgePlatform({ pbkdf2Iterations: 2000, env: {} }),
      requestDeadlineMs: 50,
      onStall,
      mountEarly: (api) => {
        api.get("/stuck", () => new Promise<Response>(() => {}));
        api.get("/quick", (c) => c.json({ ok: true }));
      },
    });
    const stuck = await app.request("/api/v1/stuck");
    expect(stuck.status).toBe(503);
    expect(await stuck.json()).toMatchObject({ error: "timeout" });
    expect(onStall).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/api/v1/stuck" }));
    expect((await app.request("/api/v1/quick")).status).toBe(200);
    expect(onStall).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("leaves slow-by-design routes alone", () => {
    for (const p of ["/api/v1/ai/recipe-from-text", "/api/v1/import/url", "/api/v1/internal/jobs/x", "/api/v1/admin/backups", "/api/v1/shopping/lists/1/events", "/api/v1/household/export"])
      expect(NO_DEADLINE.test(p)).toBe(true);
    for (const p of ["/api/v1/recipes", "/api/v1/auth/me", "/api/v1/recipes/soup/image", "/api/v1/meal-plan"]) expect(NO_DEADLINE.test(p)).toBe(false);
  });
});
