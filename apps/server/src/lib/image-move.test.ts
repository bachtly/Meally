import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiskImageStore } from "../adapters/node/images.js";
import { createSupabaseImageStore } from "../adapters/supabase/images.js";
import { openTestDb } from "../db/testing.js";
import { imageMoves, users } from "../db/schema/index.js";
import { moveLegacyImages } from "./image-move.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "meally-move-"));
  dirs.push(d);
  return d;
};

describe("moveLegacyImages (Node files)", () => {
  it("moves the household folder to the user folder, deletes the row, and is safe to repeat", async () => {
    const dir = tmp();
    const { db, ready } = openTestDb();
    await ready;
    await db.insert(users).values({ id: "u1", email: "u1@x.test", name: "U", passwordHash: "x", role: "member", createdAt: new Date() });
    await db.insert(imageMoves).values({ householdId: "h1", userId: "u1" });
    const old = path.join(dir, "images", "h1");
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, "a-full.webp"), "A");
    fs.writeFileSync(path.join(old, "a-thumb.webp"), "T");
    // an earlier run crashed after copying one file but before deleting it
    fs.mkdirSync(path.join(dir, "images", "u1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "images", "u1", "a-full.webp"), "A");

    const store = createDiskImageStore(dir);
    expect(await moveLegacyImages(db, store)).toEqual({ folders: 1, files: 2 });
    expect(fs.readdirSync(path.join(dir, "images", "u1")).sort()).toEqual(["a-full.webp", "a-thumb.webp"]);
    expect(fs.readFileSync(path.join(dir, "images", "u1", "a-thumb.webp"), "utf8")).toBe("T");
    expect(fs.existsSync(old)).toBe(false);
    expect(await db.select().from(imageMoves)).toEqual([]);
    expect(await moveLegacyImages(db, store)).toEqual({ folders: 0, files: 0 });
  });

  it("keeps the row when the move fails, so the next start retries", async () => {
    const { db, ready } = openTestDb();
    await ready;
    await db.insert(users).values({ id: "u1", email: "u1@x.test", name: "U", passwordHash: "x", role: "member", createdAt: new Date() });
    await db.insert(imageMoves).values({ householdId: "h1", userId: "u1" });
    const store = { ...createDiskImageStore(tmp()), moveOwner: async () => Promise.reject(new Error("disk full")) };
    await expect(moveLegacyImages(db, store)).rejects.toThrow("disk full");
    expect(await db.select().from(imageMoves)).toHaveLength(1);
  });
});

describe("Supabase Storage moveOwner", () => {
  function fake() {
    const objects = new Set(["h1/a-full", "h1/a-thumb", "u1/a-full"]); // u1/a-full: copied by an interrupted run
    const calls: string[] = [];
    const fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push(`${init?.method} ${url.split("/storage/v1")[1]}`);
      if (url.endsWith("/object/list/meally-images")) {
        const names = [...objects].filter((o) => o.startsWith(`${body.prefix}/`)).map((o) => ({ name: o.slice(body.prefix.length + 1) }));
        return new Response(JSON.stringify(names), { status: 200 });
      }
      if (url.endsWith("/object/copy")) {
        if (objects.has(body.destinationKey)) return new Response("{}", { status: 400 });
        objects.add(body.destinationKey);
        return new Response("{}", { status: 200 });
      }
      if (init?.method === "DELETE") {
        for (const p of body.prefixes as string[]) objects.delete(p);
        return new Response("[]", { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;
    return { objects, calls, fetch };
  }

  it("copies before it deletes, treats an existing destination as copied, and returns the count", async () => {
    const f = fake();
    const store = createSupabaseImageStore({ url: "https://x.supabase.co", serviceKey: "k", bucket: "meally-images", fetch: f.fetch });
    expect(await store.moveOwner("h1", "u1")).toBe(2);
    expect([...f.objects].sort()).toEqual(["u1/a-full", "u1/a-thumb"]);
    expect(f.calls.findIndex((c) => c.includes("/object/copy"))).toBeLessThan(f.calls.findIndex((c) => c.startsWith("DELETE")));
    expect(await store.moveOwner("h1", "u1")).toBe(0);
  });
});
