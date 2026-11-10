/**
 * Offline restore: `npm run restore -w apps/server -- <backup.zip> [--force]`.
 * Refuses to run while the server holds the lock file. The current data is moved aside, never deleted.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";
import { PGlite } from "@electric-sql/pglite";
import { migrationCount } from "./db/index.js";
import { safeEntryName } from "./features/import-files/zip.js";
import { MANIFEST_FORMAT, type Manifest } from "./features/backups/service.js";
import { lockPath, isLocked } from "./lib/lock.js";

const open = (file: string) =>
  new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (e, z) => (e || !z ? reject(e ?? new Error("Cannot open zip")) : resolve(z))),
  );

const stream = (zip: yauzl.ZipFile, entry: yauzl.Entry) =>
  new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (e, s) => (e || !s ? reject(e ?? new Error("Cannot read entry")) : resolve(s))));

function entries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const out: yauzl.Entry[] = [];
    zip.on("entry", (e: yauzl.Entry) => {
      out.push(e);
      zip.readEntry();
    });
    zip.on("end", () => resolve(out));
    zip.on("error", reject);
    zip.readEntry();
  });
}

async function readText(zip: yauzl.ZipFile, e: yauzl.Entry): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of await stream(zip, e)) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export interface RestoreResult {
  movedTo: string;
  manifest: Manifest;
}

export async function restore(zipFile: string, dataDir: string, opts: { force?: boolean; knownMigrations?: number } = {}): Promise<RestoreResult> {
  if (!opts.force && isLocked(dataDir)) throw new Error(`The server looks like it is running (lock file ${lockPath(dataDir)}). Stop it first.`);
  const zip = await open(zipFile);
  try {
    const all = (await entries(zip)).filter((e) => !e.fileName.endsWith("/"));
    const named = all.map((e) => ({ e, name: safeEntryName(e.fileName) }));
    const mf = named.find((x) => x.name === "manifest.json");
    if (!mf) throw new Error("Not a Meally backup: manifest.json is missing");
    const manifest = JSON.parse(await readText(zip, mf.e)) as Manifest;
    if (manifest.format !== MANIFEST_FORMAT) throw new Error(`Unsupported backup format ${String(manifest.format)}`);
    const known = opts.knownMigrations ?? migrationCount();
    if (typeof manifest.schemaMigrations !== "number" || manifest.schemaMigrations > known) {
      throw new Error(`This backup needs a newer Meally (schema ${String(manifest.schemaMigrations)}, this build knows ${known}). Upgrade first.`);
    }
    if (!named.some((x) => x.name === "pgdata.tar.gz")) throw new Error("Not a Meally backup: pgdata.tar.gz is missing");

    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    const movedTo = path.join(dataDir, `pre-restore-${stamp}`);
    await fs.promises.mkdir(movedTo, { recursive: true });
    for (const n of ["pgdata", "images"]) {
      const src = path.join(dataDir, n);
      if (fs.existsSync(src)) await fs.promises.rename(src, path.join(movedTo, n));
    }
    for (const { e, name } of named) {
      if (name !== "pgdata.tar.gz" && !name.startsWith("images/")) continue;
      const dest = path.join(dataDir, name === "pgdata.tar.gz" ? "pgdata-restore.tar.gz" : name);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await pipeline(await stream(zip, e), fs.createWriteStream(dest));
    }
    // Unpack the PGlite snapshot into a fresh pgdata directory.
    const tarball = path.join(dataDir, "pgdata-restore.tar.gz");
    const pg = new PGlite(path.join(dataDir, "pgdata"), { loadDataDir: new Blob([new Uint8Array(await fs.promises.readFile(tarball))]) });
    await pg.waitReady;
    await pg.close();
    await fs.promises.rm(tarball, { force: true });
    return { movedTo, manifest };
  } finally {
    zip.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: npm run restore -w apps/server -- <backup.zip> [--force]");
    process.exit(2);
  }
  const dataDir = process.env.DATA_DIR ?? "./data";
  try {
    const r = await restore(path.resolve(file), dataDir, { force });
    console.log(`Restored backup from ${r.manifest.createdAt} (app ${r.manifest.appVersion}).`);
    console.log(`Previous data moved to ${r.movedTo}. Start the server again.`);
  } catch (e) {
    console.error(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
