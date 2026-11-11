import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };
const N = { calories: 240, proteinG: 12, carbsG: 30, fatG: 8, sodiumMg: 480, source: "Label" };

async function boot(on: boolean) {
  const app = createApp({
    env: { MEALLY_SIGNUP_MODE: "open", ...(on ? { MEALLY_FEATURE_NUTRITION: "on" } : {}) },
    scryptLogN: 10,
  });
  const res = await app.request("/api/v1/auth/setup", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email: "a@example.com", name: "a", password: "correct horse" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const call = (method: string, url: string, body?: unknown) =>
    app.request(`/api/v1${url}`, { method, headers: { ...H, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { app, call };
}

describe("nutrition on", () => {
  it("saves, returns, updates and clears", async () => {
    const { call } = await boot(true);
    const made = (await (await call("POST", "/recipes", { name: "Soup", nutrition: N })).json()) as any;
    expect(made.nutrition).toMatchObject(N);
    expect(made.nutrition.fibreG).toBeNull();
    const got = (await (await call("GET", "/recipes/soup")).json()) as any;
    expect(got.nutrition).toMatchObject(N);
    // omitted leaves it alone
    const kept = (await (await call("PUT", "/recipes/soup", { name: "Soup" })).json()) as any;
    expect(kept.nutrition).toMatchObject(N);
    const changed = (await (await call("PUT", "/recipes/soup", { name: "Soup", nutrition: { calories: 100 } })).json()) as any;
    expect(changed.nutrition.calories).toBe(100);
    expect(changed.nutrition.proteinG).toBeNull();
    const cleared = (await (await call("PUT", "/recipes/soup", { name: "Soup", nutrition: {} })).json()) as any;
    expect(cleared.nutrition).toBeNull();
  });
  it("rejects negative values", async () => {
    const { call } = await boot(true);
    expect((await call("POST", "/recipes", { name: "X", nutrition: { calories: -1 } })).status).toBe(400);
  });
});

describe("nutrition off", () => {
  it("ignores and omits it", async () => {
    const { call } = await boot(false);
    const made = (await (await call("POST", "/recipes", { name: "Soup", nutrition: N })).json()) as any;
    expect("nutrition" in made).toBe(false);
    expect("nutrition" in ((await (await call("GET", "/recipes/soup")).json()) as any)).toBe(false);
  });
});
