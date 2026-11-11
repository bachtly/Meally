import { describe, expect, it } from "vitest";
import { hashPassword } from "../features/auth/password.js";
import { hashPbkdf2 } from "../features/auth/pbkdf2.js";
import { createHasher } from "./hasher.js";
import { createApp } from "../app.js";
import { users } from "../db/schema/index.js";
import { createTestDb } from "../db/testing.js";

const scryptPrefer = createHasher({ kind: "scrypt", logN: 10 });
const pbkdf2Prefer = createHasher({ kind: "pbkdf2", iterations: 1000 });

describe("password hashers", () => {
  it("writes the documented pbkdf2 format and verifies it", async () => {
    const h = await pbkdf2Prefer.hash("pw one");
    expect(h).toMatch(/^pbkdf2-sha256\$1000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await pbkdf2Prefer.verify("pw one", h)).toEqual({ ok: true, needsRehash: false });
    expect((await pbkdf2Prefer.verify("pw two", h)).ok).toBe(false);
    expect(await pbkdf2Prefer.verify("pw one", "pbkdf2-sha256$1000$bad")).toEqual({ ok: false, needsRehash: false });
  });

  it("verifies both formats and flags a different scheme or a lower cost", async () => {
    const scrypt = await hashPassword("pw", 10);
    const pbkdf2 = await hashPbkdf2("pw", 1000);
    expect(await scryptPrefer.verify("pw", scrypt)).toEqual({ ok: true, needsRehash: false });
    expect(await scryptPrefer.verify("pw", pbkdf2)).toEqual({ ok: true, needsRehash: true });
    expect(await pbkdf2Prefer.verify("pw", pbkdf2)).toEqual({ ok: true, needsRehash: false });
    expect(await pbkdf2Prefer.verify("pw", scrypt)).toEqual({ ok: true, needsRehash: true });
    expect(await createHasher({ kind: "pbkdf2", iterations: 5000 }).verify("pw", pbkdf2)).toEqual({ ok: true, needsRehash: true });
    expect(await createHasher({ kind: "scrypt", logN: 11 }).verify("pw", scrypt)).toEqual({ ok: true, needsRehash: true });
    expect(await scryptPrefer.verify("nope", pbkdf2)).toEqual({ ok: false, needsRehash: false });
  });

  it("rehashes on login to the platform's preferred scheme", async () => {
    const { db } = await createTestDb();
    const app = createApp({ db, scryptLogN: 10, env: { MEALLY_SIGNUP_MODE: "open" } });
    const H = { "content-type": "application/json", "x-requested-with": "meally" };
    const call = (path: string, body: unknown) => app.request(`/api/v1/auth/${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    expect((await call("setup", { email: "a@example.com", name: "A", password: "some password" })).status).toBe(201);
    // Simulate a hash written by the edge platform.
    const old = await hashPbkdf2("some password", 1000);
    await db.update(users).set({ passwordHash: old });
    expect((await call("login", { email: "a@example.com", password: "some password" })).status).toBe(200);
    const [row] = await db.select().from(users);
    expect(row!.passwordHash).toMatch(/^scrypt\$1024\$/);
    expect((await call("login", { email: "a@example.com", password: "some password" })).status).toBe(200);
    expect((await call("login", { email: "a@example.com", password: "wrong" })).status).toBe(401);
  });
});
