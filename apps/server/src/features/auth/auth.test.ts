import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createRateLimiter } from "../../lib/rate-limit.js";
import { hashPassword, verifyPassword } from "./password.js";

function makeApp(env: Record<string, string> = {}) {
  return createApp({ env, scryptLogN: 10 });
}
type App = ReturnType<typeof makeApp>;

const H = { "content-type": "application/json", "x-requested-with": "meally" };
const post = (app: App, path: string, data: unknown, cookie?: string) =>
  app.request(`/api/v1/auth/${path}`, {
    method: "POST",
    headers: cookie ? { ...H, cookie } : H,
    body: JSON.stringify(data),
  });
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;
const me = (app: App, cookie: string) => app.request("/api/v1/auth/me", { headers: { cookie } });
const admin = { email: "Admin@Example.com", name: "Ada", password: "correct horse" };

describe("password hashing", () => {
  it("verifies the right password only, with salted output", async () => {
    const a = await hashPassword("secret-pass");
    const b = await hashPassword("secret-pass");
    expect(a).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("secret-pass", a)).toBe(true);
    expect(await verifyPassword("other-pass", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("rate limiter", () => {
  it("blocks past the max and resets after the window", () => {
    let t = 0;
    const rl = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
    expect(rl.hit("k").ok).toBe(true);
    expect(rl.hit("k").ok).toBe(true);
    expect(rl.hit("k").ok).toBe(false);
    expect(rl.hit("other").ok).toBe(true);
    t = 1001;
    expect(rl.hit("k").ok).toBe(true);
  });
});

describe("auth routes", () => {
  it("setup works once and creates the admin", async () => {
    const app = makeApp();
    expect(await (await app.request("/api/v1/auth/status")).json()).toEqual({ needsSetup: true, signupMode: "invite" });
    const res = await post(app, "setup", admin);
    expect(res.status).toBe(201);
    const cookie = cookieOf(res);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(res.headers.get("set-cookie")).not.toMatch(/Secure/i);
    const body = (await (await me(app, cookie)).json()) as any;
    expect(body.user).toMatchObject({ email: "admin@example.com", role: "admin" });
    expect(body).not.toHaveProperty("household");
    expect(body.user).not.toHaveProperty("householdId");
    expect(body.user).not.toHaveProperty("householdRole");
    expect((await post(app, "setup", { ...admin, email: "b@example.com" })).status).toBe(409);
    expect(((await (await app.request("/api/v1/auth/status")).json()) as any).needsSetup).toBe(false);
  });

  it("validates bodies", async () => {
    const app = makeApp();
    expect((await post(app, "setup", { ...admin, password: "short" })).status).toBe(400);
    expect((await post(app, "setup", { ...admin, email: "nope" })).status).toBe(400);
  });

  it("sets Secure cookies for https BASE_URL", async () => {
    const app = makeApp({ BASE_URL: "https://meally.example.com" });
    const res = await post(app, "setup", admin);
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("login succeeds and fails with a generic error", async () => {
    const app = makeApp();
    await post(app, "setup", admin);
    const ok = await post(app, "login", { email: "ADMIN@example.com", password: admin.password });
    expect(ok.status).toBe(200);
    const bad = await post(app, "login", { email: "admin@example.com", password: "wrong-password" });
    const unknown = await post(app, "login", { email: "nobody@example.com", password: "wrong-password" });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await bad.json()).toEqual(await unknown.json());
  });

  it("rate limits login after 10 attempts", async () => {
    const app = makeApp();
    await post(app, "setup", admin);
    for (let i = 0; i < 10; i++) {
      expect((await post(app, "login", { email: "admin@example.com", password: "wrong-password" })).status).toBe(401);
    }
    const res = await post(app, "login", { email: "admin@example.com", password: admin.password });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("logout invalidates the session", async () => {
    const app = makeApp();
    const cookie = cookieOf(await post(app, "setup", admin));
    expect((await me(app, cookie)).status).toBe(200);
    expect((await post(app, "logout", {}, cookie)).status).toBe(200);
    expect((await me(app, cookie)).status).toBe(401);
  });

  it("rejects unauthenticated me", async () => {
    expect((await makeApp().request("/api/v1/auth/me")).status).toBe(401);
  });

  it("register: closed blocks, invite needs a token, open creates an account", async () => {
    const reg = { email: "u@example.com", name: "Uma", password: "another pass" };
    for (const [mode, status, code] of [
      ["closed", 403, "signup_closed"],
      ["invite", 403, "invite_required"],
    ] as const) {
      const app = makeApp({ MEALLY_SIGNUP_MODE: mode });
      await post(app, "setup", admin);
      const res = await post(app, "register", reg);
      expect(res.status).toBe(status);
      expect(((await res.json()) as any).error).toBe(code);
    }
    const app = makeApp({ MEALLY_SIGNUP_MODE: "open" });
    expect((await post(app, "register", reg)).status).toBe(409); // setup first
    const adminCookie = cookieOf(await post(app, "setup", admin));
    const res = await post(app, "register", reg);
    expect(res.status).toBe(201);
    const userCookie = cookieOf(res);
    const a = (await (await me(app, adminCookie)).json()) as any;
    const u = (await (await me(app, userCookie)).json()) as any;
    expect(u.user.email).toBe("u@example.com");
    expect(u.user.role).toBe("member");
    expect(u.user.id).not.toBe(a.user.id);
    expect(a.user.email).toBe("admin@example.com");
    expect((await post(app, "register", reg)).status).toBe(409);
  });

  it("csrf: cookie sessions need same origin or X-Requested-With", async () => {
    const app = makeApp();
    const cookie = cookieOf(await post(app, "setup", admin));
    const call = (headers: Record<string, string>) =>
      app.request("/api/v1/auth/logout", { method: "POST", headers: { cookie, ...headers } });
    expect((await call({})).status).toBe(403);
    expect((await call({ origin: "https://evil.example" })).status).toBe(403);
    expect((await call({ origin: "http://localhost" })).status).toBe(200);
    expect((await call({ "x-requested-with": "meally" })).status).toBe(200);
  });
});
