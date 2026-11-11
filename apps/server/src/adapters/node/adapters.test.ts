import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../../features/auth/password.js";
import { createDiskImageStore } from "./images.js";
import { NodeEvents } from "./events.js";
import { createNodeScheduler } from "./scheduler.js";
import { createScryptHasher } from "./hasher.js";

afterEach(() => vi.useRealTimers());

describe("disk image store", () => {
  it("processes, serves and deletes every size", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-img-"));
    try {
      const store = createDiskImageStore(dir);
      const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#c33" } }).png().toBuffer();
      const id = await store.putOriginal("h1", png);
      const big = await store.get("h1", id, 1600);
      expect(big?.contentType).toBe("image/webp");
      expect((await sharp(big!.bytes).metadata()).width).toBe(1600);
      expect(await store.get("h2", id, 800)).toBeNull();
      expect(await store.urlFor("h1", id, 800)).toBeNull();
      expect(store.localDir).toBe(path.join(dir, "images"));
      await store.delete("h1", id);
      expect(await store.get("h1", id, 320)).toBeNull();
      await store.delete("h1", id); // missing is fine
      await store.put("h1", "x", 320, new Uint8Array([1, 2]), "image/webp");
      expect((await store.get("h1", "x", 320))?.bytes).toEqual(new Uint8Array([1, 2]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects bad input and leaves nothing behind", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-img-"));
    try {
      await expect(createDiskImageStore(dir).putOriginal("h1", new Uint8Array([1, 2, 3]))).rejects.toThrow();
      expect(fs.existsSync(path.join(dir, "images", "h1")) ? fs.readdirSync(path.join(dir, "images", "h1")) : []).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("node events", () => {
  it("delivers per channel and unsubscribes", () => {
    const ev = new NodeEvents();
    const got: unknown[] = [];
    const off = ev.subscribe("a", (e) => got.push(e));
    ev.publish("a", 1);
    ev.publish("b", 2);
    expect(got).toEqual([1]);
    expect(ev.supportsStreaming).toBe(true);
    off();
    ev.publish("a", 3);
    expect(got).toEqual([1]);
    expect(ev.listenerCount("a")).toBe(0);
  });
});

describe("node scheduler", () => {
  it("runs one-offs, intervals and named jobs; stop cancels", async () => {
    vi.useFakeTimers();
    const s = createNodeScheduler();
    const calls: unknown[] = [];
    s.define("j", (p) => void calls.push(p ?? "tick"));
    s.runAfter("j", 100, "once");
    s.every("j", 1000, { firstInMs: 10 });
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(["tick", "once"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(3);
    await s.runJob("j", "now");
    expect(calls.at(-1)).toBe("now");
    s.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(4);
    await expect(s.runJob("nope")).rejects.toThrow(/Unknown job/);
  });
  it("runs a daily job at the local time and re-arms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    const s = createNodeScheduler();
    const fn = vi.fn();
    s.define("d", fn);
    s.daily("d", "09:30");
    await vi.advanceTimersByTimeAsync(89 * 60_000);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(fn).toHaveBeenCalledTimes(2);
    s.stop();
  });
  it("logs a failing handler instead of throwing", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const s = createNodeScheduler(log);
    s.define("bad", () => {
      throw new Error("boom");
    });
    s.runAfter("bad", 1);
    await vi.advanceTimersByTimeAsync(5);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});

describe("scrypt hasher", () => {
  it("verifies, keeps the scrypt$ format valid and flags weaker hashes", async () => {
    const h = createScryptHasher(10);
    const stored = await h.hash("pw-123456");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await h.verify("pw-123456", stored)).toEqual({ ok: true, needsRehash: false });
    expect((await h.verify("nope", stored)).ok).toBe(false);
    expect((await h.verify("x", "garbage")).ok).toBe(false);
    const old = await hashPassword("pw-123456", 9);
    expect(await h.verify("pw-123456", old)).toEqual({ ok: true, needsRehash: true });
  });
});
