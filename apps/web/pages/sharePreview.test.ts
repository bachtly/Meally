import { describe, expect, it, vi } from "vitest";
import { sharePreview } from "./sharePreview";

const BASE = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/meally";
const INDEX = "<!doctype html><html><head><title>Meally</title></head><body><div id=root></div></body></html>";
const page = () => async () => new Response(INDEX, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
const meta = { kind: "set", title: "Weekend", note: null, sharedBy: "Ada", count: 3, imagePath: "/api/v1/public/shares/tok/recipes/a/image/800", recipe: null };

describe("Pages /s/* link previews", () => {
  it("injects Open Graph tags from the meta endpoint, forwarding the client IP", async () => {
    const send = vi.fn(async () => Response.json(meta));
    const req = new Request("https://meally.example/s/tok", { headers: { "cf-connecting-ip": "203.0.113.7" } });
    const res = await sharePreview(req, page(), BASE, send as unknown as typeof fetch);
    const html = await res.text();
    expect(send).toHaveBeenCalledWith(
      `${BASE}/api/v1/public/shares/tok/meta`,
      expect.objectContaining({ headers: expect.objectContaining({ "x-forwarded-for": "203.0.113.7" }) }),
    );
    expect(html).toContain('<meta property="og:title" content="Weekend" />');
    expect(html).toContain('content="https://meally.example/api/v1/public/shares/tok/recipes/a/image/800"');
    expect(html).toContain("<title>Weekend · Meally</title>");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("also covers a recipe inside a link", async () => {
    const send = vi.fn(async () => Response.json(meta));
    await sharePreview(new Request("https://meally.example/s/tok/a"), page(), BASE, send as unknown as typeof fetch);
    expect(send).toHaveBeenCalledWith(`${BASE}/api/v1/public/shares/tok/meta`, expect.anything());
  });

  it("serves the plain page when the link is dead or the API is down", async () => {
    const fails = [vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })), vi.fn(async () => Promise.reject(new Error("down")))];
    for (const send of fails) {
      const res = await sharePreview(new Request("https://meally.example/s/dead"), page(), BASE, send as unknown as typeof fetch);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(INDEX);
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  it("leaves other paths untouched", async () => {
    const send = vi.fn();
    const res = await sharePreview(new Request("https://meally.example/s/tok/a/b"), page(), BASE, send as unknown as typeof fetch);
    expect(await res.text()).toBe(INDEX);
    expect(send).not.toHaveBeenCalled();
  });
});
