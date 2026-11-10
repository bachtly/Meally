import { describe, expect, it, vi } from "vitest";
import { createFetcher, type Transport } from "./fetch.js";
import { isBlockedIp } from "./ssrf.js";

const html = (body = "<html></html>", extra: object = {}) => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8", ...extra },
  body: (async function* () {
    yield Buffer.from(body);
  })(),
  destroy() {},
});
const redirect = (to: string) => ({ status: 302, headers: { location: to }, body: (async function* () {})(), destroy() {} });
const pub = async () => ["93.184.216.34"];

describe("isBlockedIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "nonsense"])(
    "blocks %s",
    (ip) => expect(isBlockedIp(ip)).toBe(true),
  );
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("createFetcher SSRF protection", () => {
  const blocked = (url: string, deps = {}) =>
    expect(createFetcher({ resolve: pub, transport: vi.fn(), ...deps })(url, { kind: "html" })).rejects.toMatchObject({ code: "blocked_url" });

  it("rejects private literals", async () => {
    for (const u of ["http://127.0.0.1/", "http://10.0.0.5/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/"]) await blocked(u);
  });
  it("rejects other schemes, odd ports and credentials", async () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com/", "gopher://example.com", "http://example.com:8080/", "http://a:b@example.com/", "nope"]) await blocked(u);
  });
  it("rejects a DNS name that resolves to a private address (any answer)", async () => {
    await blocked("http://evil.example/", { resolve: async () => ["93.184.216.34", "10.0.0.1"] });
  });
  it("rejects a redirect to a private address", async () => {
    const transport = vi.fn(async () => redirect("http://169.254.169.254/")) as unknown as Transport;
    await blocked("http://example.com/", { transport });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("allows private targets and ports only with allowPrivate", async () => {
    const f = createFetcher({ allowPrivate: true, transport: async () => html("ok") });
    expect((await f("http://127.0.0.1:3000/", { kind: "html" })).body.toString()).toBe("ok");
  });
});

describe("createFetcher behaviour", () => {
  it("connects to the vetted IP and sends the user agent", async () => {
    const transport = vi.fn(async () => html()) as unknown as Transport;
    await createFetcher({ resolve: pub, transport, version: "1.2.3" })("https://example.com/a", { kind: "html" });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "93.184.216.34", headers: expect.objectContaining({ "User-Agent": "Meally/1.2.3 (+recipe import)" }) }),
    );
  });
  it("follows redirects and reports the final URL", async () => {
    let n = 0;
    const transport: Transport = async () => (n++ === 0 ? redirect("/final") : html());
    const r = await createFetcher({ resolve: pub, transport })("http://example.com/start", { kind: "html" });
    expect(r.finalUrl).toBe("http://example.com/final");
  });
  it("stops after 5 redirects", async () => {
    const transport: Transport = async () => redirect("/again");
    await expect(createFetcher({ resolve: pub, transport })("http://example.com/", { kind: "html" })).rejects.toMatchObject({ code: "fetch_failed" });
  });
  it("rejects non-HTML and oversized bodies", async () => {
    const json: Transport = async () => ({ ...html(), headers: { "content-type": "application/json" } });
    await expect(createFetcher({ resolve: pub, transport: json })("http://example.com/", { kind: "html" })).rejects.toMatchObject({ code: "fetch_failed" });
    const big: Transport = async () => html("x", { "content-length": String(6 * 1024 * 1024) });
    await expect(createFetcher({ resolve: pub, transport: big })("http://example.com/", { kind: "html" })).rejects.toMatchObject({ code: "fetch_failed" });
  });
});
