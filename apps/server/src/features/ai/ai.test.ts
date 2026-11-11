import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };
const recipe = { name: "Soup", ingredients: [{ raw: "2 cups stock", quantity: 2, unit: "cup", food: "stock" }], steps: [{ text: "Heat." }] };

async function setup(env: Record<string, string>, replies: unknown[], opts: { flag?: boolean; limit?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  const q = [...replies];
  const aiFetch = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const r = q.shift();
    if (r instanceof Error) throw r;
    if (typeof r === "number") return new Response("{}", { status: r });
    const text = typeof r === "string" ? r : JSON.stringify(r);
    const isAnthropic = String(url).includes("/v1/messages");
    return Response.json(isAnthropic ? { content: [{ type: "text", text }] } : { choices: [{ message: { content: text } }] });
  }) as unknown as typeof fetch;
  const app = createApp({ env: { MEALLY_SIGNUP_MODE: "open", MEALLY_FEATURE_AI: opts.flag === false ? "off" : "on", ...env }, scryptLogN: 10, aiFetch, aiLimit: opts.limit });
  const res = await app.request("/api/v1/auth/setup", { method: "POST", headers: H, body: JSON.stringify({ email: "a@example.com", name: "a", password: "correct horse" }) });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const post = (p: string, body: unknown) => app.request(`/api/v1/ai${p}`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify(body) });
  return { app, post, calls, cookie };
}

const anthropic = { MEALLY_AI_PROVIDER: "anthropic", MEALLY_AI_API_KEY: "sk-test" };

describe("ai routes", () => {
  it("sends the Anthropic request shape and returns a preview", async () => {
    const { post, calls } = await setup(anthropic, [recipe]);
    const r = await post("/recipe-from-text", { text: "soup: 2 cups stock. heat." });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).recipe.name).toBe("Soup");
    const c = calls[0]!;
    expect(c.url).toBe("https://api.anthropic.com/v1/messages");
    expect((c.init.headers as any)["x-api-key"]).toBe("sk-test");
    expect((c.init.headers as any)["anthropic-version"]).toBe("2023-06-01");
    expect(c.body.model).toBe("claude-sonnet-5-5");
  });

  it("sends photos as base64 image blocks (anthropic)", async () => {
    const { app, calls, cookie } = await setup(anthropic, [recipe]);
    const fd = new FormData();
    fd.append("photos", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    const r = await app.request("/api/v1/ai/recipe-from-image", { method: "POST", headers: { "x-requested-with": "meally", cookie }, body: fd });
    expect(r.status).toBe(200);
    const block = calls[0]!.body.messages[0].content[0];
    expect(block).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } });
  });

  it("uses chat completions with data URLs for OpenAI-compatible servers", async () => {
    const env = { MEALLY_AI_PROVIDER: "openai", MEALLY_AI_BASE_URL: "http://localhost:11434/", MEALLY_AI_MODEL: "llava" };
    const { app, calls, cookie } = await setup(env, [recipe]);
    const fd = new FormData();
    fd.append("photos", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
    const r = await app.request("/api/v1/ai/recipe-from-image", { method: "POST", headers: { "x-requested-with": "meally", cookie }, body: fd });
    expect(r.status).toBe(200);
    expect(calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect((calls[0]!.init.headers as any).authorization).toBeUndefined();
    expect(calls[0]!.body.model).toBe("llava");
    expect(calls[0]!.body.messages[1].content[1].image_url.url).toBe("data:image/jpeg;base64,AQID");
  });

  it("retries once on invalid JSON, then gives up with 502", async () => {
    const a = await setup(anthropic, ["not json", recipe]);
    expect((await a.post("/recipe-from-text", { text: "x" })).status).toBe(200);
    expect(a.calls).toHaveLength(2);
    expect(a.calls[1]!.body.messages[0].content[0].text).toContain("rejected");
    const b = await setup(anthropic, ["nope", { name: "" }]);
    const r = await b.post("/recipe-from-text", { text: "x" });
    expect(r.status).toBe(502);
    expect(((await r.json()) as any).error).toBe("ai_invalid_response");
  });

  it("maps provider failures", async () => {
    expect((await (await setup(anthropic, [500])).post("/recipe-from-text", { text: "x" })).status).toBe(502);
    const t = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect((await (await setup(anthropic, [t])).post("/recipe-from-text", { text: "x" })).status).toBe(504);
  });

  it("returns 503 ai_not_configured", async () => {
    const { post, app, cookie } = await setup({}, []);
    const r = await post("/recipe-from-text", { text: "x" });
    expect(r.status).toBe(503);
    expect(((await r.json()) as any).error).toBe("ai_not_configured");
    const s = await app.request("/api/v1/ai/status", { headers: { ...H, cookie } });
    expect(await s.json()).toEqual({ configured: false });
  });

  it("is blocked when the flag is off and requires auth", async () => {
    const off = await setup(anthropic, [recipe], { flag: false });
    expect((await off.post("/recipe-from-text", { text: "x" })).status).toBe(404);
    const on = await setup(anthropic, []);
    expect((await on.app.request("/api/v1/ai/recipe-from-text", { method: "POST", headers: H, body: "{}" })).status).toBe(401);
  });

  it("rate limits per user", async () => {
    const { post } = await setup(anthropic, [recipe, recipe], { limit: 2 });
    expect((await post("/recipe-from-text", { text: "x" })).status).toBe(200);
    expect((await post("/recipe-from-text", { text: "x" })).status).toBe(200);
    expect((await post("/recipe-from-text", { text: "x" })).status).toBe(429);
  });

  it("only asks the model about lines the parser could not read, and merges", async () => {
    const { post, calls } = await setup(anthropic, [{ items: [{ index: 0, quantity: null, unit: "bogus", food: "salt", note: "to taste" }] }]);
    const r = await post("/parse-ingredients", { lines: ["2 cups flour", "1 cup"] });
    const { parsed } = (await r.json()) as any;
    expect(calls[0]!.body.messages[0].content[0].text).toBe("0: 1 cup");
    expect(parsed[0].food).toBe("flour");
    expect(parsed[1]).toMatchObject({ food: "salt", unit: null, note: "to taste" });
  });
});
