import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function boot(env: Record<string, string> = {}) {
  const app = createApp({ env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10 });
  const res = await app.request("/api/v1/auth/setup", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email: "a@example.com", name: "a", password: "correct horse" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const post = (body: unknown, c: string | null = cookie) =>
    app.request("/api/v1/ingredients/parse", {
      method: "POST",
      headers: c ? { ...H, cookie: c } : H,
      body: JSON.stringify(body),
    });
  return { post };
}

describe("POST /ingredients/parse", () => {
  it("requires auth", async () => {
    const { post } = await boot();
    expect((await post({ lines: [] }, null)).status).toBe(401);
  });
  it("parses lines", async () => {
    const { post } = await boot();
    const res = await post({ lines: ["1 1/2 cups flour, sifted", "salt to taste"] });
    expect(res.status).toBe(200);
    const { parsed } = (await res.json()) as any;
    expect(parsed[0]).toMatchObject({ quantity: 1.5, unit: "cup", food: "flour", note: "sifted" });
    expect(parsed[1]).toMatchObject({ quantity: null, food: "salt", note: "to taste" });
  });
  it("rejects a bad body", async () => {
    const { post } = await boot();
    expect((await post({ lines: "x" })).status).toBe(400);
  });
  it("404s when the flag is off", async () => {
    const { post } = await boot({ MEALLY_FEATURE_INGREDIENT_PARSER: "off" });
    expect((await post({ lines: ["1 egg"] })).status).toBe(404);
  });
});
