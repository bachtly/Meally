import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it } from "vitest";

const real = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const REKEY = "0005_rekey_users";
const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** A migrations folder holding only the files before the rekey, so the test can load legacy rows first. */
function oldFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-rekey-"));
  tmp.push(dir);
  fs.cpSync(real, dir, { recursive: true });
  const journalPath = path.join(dir, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e: { tag: string }) => e.tag === REKEY));
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

async function legacyDb() {
  const pg = new PGlite("memory://");
  const db = drizzle(pg);
  await migrate(db, { migrationsFolder: oldFolder() });
  return { pg, db };
}

const now = "2026-01-01T00:00:00Z";
async function household(pg: PGlite, h: string, users: string[]) {
  await pg.query(`INSERT INTO households (id, name, created_at) VALUES ($1, $1, $2)`, [h, now]);
  for (const u of users) {
    await pg.query(`INSERT INTO users (id, email, name, password_hash, role, household_id, created_at) VALUES ($1, $1 || '@x.test', $1, 'x', 'member', $2, $3)`, [u, h, now]);
  }
}

describe("0005_rekey_users", () => {
  it("rekeys every household table to the single user and drops households", async () => {
    const { pg, db } = await legacyDb();
    await household(pg, "h1", ["u1"]);
    await household(pg, "h2", ["u2"]);
    await household(pg, "h3", []); // no member: its data is unreachable and goes
    await pg.query(`INSERT INTO images (id, household_id, created_at) VALUES ('img1', 'h1', $1)`, [now]);
    for (const [id, h] of [["r1", "h1"], ["r2", "h2"], ["r3", "h3"]] as const) {
      await pg.query(`INSERT INTO recipes (id, household_id, slug, name, created_at, updated_at) VALUES ($1, $2, 'soup', 'Soup', $3, $3)`, [id, h, now]);
    }
    await pg.query(`INSERT INTO aisle_labels (id, household_id, name, position) VALUES ('al1', 'h1', 'Dairy', 0)`);
    await pg.query(`INSERT INTO food_aisles (household_id, food, aisle_id) VALUES ('h1', 'milk', 'al1')`);
    await pg.query(`INSERT INTO household_feed_tokens (household_id, token, created_at) VALUES ('h1', 'tok1', $1)`, [now]);
    await pg.query(`INSERT INTO timeline_events (id, household_id, recipe_id, user_id, kind, created_at) VALUES ('t1', 'h1', 'r1', NULL, 'comment', $1)`, [now]);
    await pg.query(`INSERT INTO import_jobs (id, household_id, user_id, format, status, created_at) VALUES ('j1', 'h2', NULL, 'json', 'done', $1)`, [now]);
    await pg.query(`INSERT INTO api_tokens (id, user_id, household_id, name, token_hash, prefix, scopes, created_at) VALUES ('k1', 'u1', 'h1', 'k', 'hash', 'mly_', 'read', $1)`, [now]);
    await pg.query(`INSERT INTO invites (id, household_id, token_hash, role, created_by, expires_at, created_at) VALUES ('i1', 'h1', 'ih', 'member', 'u1', $1, $1)`, [now]);

    await migrate(db, { migrationsFolder: real });

    const rows = async (q: string) => (await pg.query<Record<string, unknown>>(q)).rows;
    expect(await rows(`SELECT id, user_id FROM recipes ORDER BY id`)).toEqual([
      { id: "r1", user_id: "u1" },
      { id: "r2", user_id: "u2" },
    ]);
    expect(await rows(`SELECT id, user_id FROM images`)).toEqual([{ id: "img1", user_id: "u1" }]);
    expect(await rows(`SELECT user_id, food FROM food_aisles`)).toEqual([{ user_id: "u1", food: "milk" }]);
    expect(await rows(`SELECT user_id, token FROM user_feed_tokens`)).toEqual([{ user_id: "u1", token: "tok1" }]);
    expect(await rows(`SELECT user_id FROM timeline_events`)).toEqual([{ user_id: "u1" }]);
    expect(await rows(`SELECT user_id FROM import_jobs`)).toEqual([{ user_id: "u2" }]);
    expect(await rows(`SELECT id, user_id FROM api_tokens`)).toEqual([{ id: "k1", user_id: "u1" }]);
    expect(await rows(`SELECT household_id, user_id FROM image_moves ORDER BY household_id`)).toEqual([
      { household_id: "h1", user_id: "u1" },
      { household_id: "h2", user_id: "u2" },
    ]);
    // households, invites and the household columns are gone
    expect(await rows(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('households','invites','household_feed_tokens')`)).toEqual([]);
    expect(await rows(`SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE 'household%' AND table_name <> 'image_moves'`)).toEqual([]);
    // the new keys work: one slug per user, but the same slug for another user
    await expect(pg.query(`INSERT INTO recipes (id, user_id, slug, name, created_at, updated_at) VALUES ('r9', 'u1', 'soup', 'Soup', $1, $1)`, [now])).rejects.toThrow();
    await expect(pg.query(`INSERT INTO food_aisles (user_id, food, aisle_id) VALUES ('u1', 'milk', 'al1')`)).rejects.toThrow();
    // deleting a user removes their data
    await pg.query(`DELETE FROM users WHERE id = 'u1'`);
    expect(await rows(`SELECT id FROM recipes`)).toEqual([{ id: "r2" }]);
  });

  it("aborts and changes nothing when a household has more than one member", async () => {
    const { pg, db } = await legacyDb();
    await household(pg, "h1", ["u1", "u2"]);
    await pg.query(`INSERT INTO recipes (id, household_id, slug, name, created_at, updated_at) VALUES ('r1', 'h1', 'soup', 'Soup', $1, $1)`, [now]);

    await expect(migrate(db, { migrationsFolder: real })).rejects.toThrow(/more than one member/);

    const cols = await pg.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'recipes'`);
    expect(cols.rows.map((r) => r.column_name)).toContain("household_id");
    expect(cols.rows.map((r) => r.column_name)).not.toContain("user_id");
    expect((await pg.query(`SELECT 1 FROM households`)).rows).toHaveLength(1);
    expect((await pg.query(`SELECT 1 FROM recipes`)).rows).toHaveLength(1);
    // the failed run is not recorded, so fixing the data and restarting applies it
    await pg.query(`INSERT INTO households (id, name, created_at) VALUES ('h2', 'h2', $1)`, [now]);
    await pg.query(`UPDATE users SET household_id = 'h2' WHERE id = 'u2'`);
    await migrate(db, { migrationsFolder: real });
    expect((await pg.query(`SELECT user_id FROM recipes`)).rows).toEqual([{ user_id: "u1" }]);
  });
});
