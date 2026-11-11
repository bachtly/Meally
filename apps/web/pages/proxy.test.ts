import { describe, expect, it, vi } from "vitest";
import { proxy, upstreamUrl } from "./proxy";

const BASE = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/meally";

describe("Pages /api proxy", () => {
  it("keeps the path and query", () => {
    expect(upstreamUrl("https://meally.example.com/api/v1/recipes?limit=20&cursor=x", BASE)).toBe(
      `${BASE}/api/v1/recipes?limit=20&cursor=x`,
    );
  });

  it("forwards method, cookie, origin and body; sets the client IP; never follows redirects", async () => {
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    const req = new Request("https://meally.example.com/api/v1/auth/login", {
      method: "POST",
      headers: { cookie: "meally_session=abc", origin: "https://meally.example.com", "cf-connecting-ip": "203.0.113.7", "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    });
    await proxy(req, BASE, send as unknown as typeof fetch);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/auth/login`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const h = new Headers(init.headers);
    expect(h.get("cookie")).toBe("meally_session=abc");
    expect(h.get("origin")).toBe("https://meally.example.com");
    expect(h.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(h.has("host")).toBe(false);
    expect(await new Response(init.body).text()).toBe('{"email":"a@b.c"}');
  });

  it("sends no body on GET and passes the response through untouched", async () => {
    const upstream = new Response("{}", { status: 302, headers: { location: "https://storage.example/x", "set-cookie": "a=b" } });
    const send = vi.fn(async () => upstream);
    const res = await proxy(new Request("https://meally.example.com/api/v1/images/1"), BASE, send as unknown as typeof fetch);
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(res).toBe(upstream);
  });
});
