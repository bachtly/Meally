import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { migrationCount } from "../../db/index.js";
import { ApiError } from "../../lib/errors.js";
import { writeZipFile } from "./zipwriter.js";

export const MANIFEST_FORMAT = 1;
export interface Manifest {
  format: number;
  appVersion: string;
  schemaMigrations: number;
  createdAt: string;
}

/** Strict: only names we generate. No separators, dots or case tricks can pass. */
export const BACKUP_NAME = /^meally-\d{8}T\d{6,9}Z\.zip$/;
export function validBackupName(name: string): boolean {
  return BACKUP_NAME.test(name);
}

export const backupDir = (dataDir: string) => path.join(dataDir, "backups");
export function backupFile(dataDir: string, name: string): string {
  if (!validBackupName(name)) throw new ApiError(404, "not_found", "Backup not found");
  return path.join(backupDir(dataDir), name);
}

export interface BackupSettings {
  hours: number;
  keep: number;
}
/** Read-only schedule from the environment. 0 hours means scheduled backups are off. */
export function backupSettings(env: Record<string, string | undefined>): BackupSettings {
  const h = Number(env.MEALLY_BACKUP_CRON_HOURS ?? 24);
  const k = Number(env.MEALLY_BACKUP_KEEP ?? 7);
  return { hours: Number.isFinite(h) && h > 0 ? h : 0, keep: Number.isInteger(k) && k >= 1 ? k : 7 };
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

export async function listBackups(dataDir: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(backupDir(dataDir));
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names.filter(validBackupName)) {
    const st = await fs.promises.stat(path.join(backupDir(dataDir), name)).catch(() => null);
    if (st?.isFile()) out.push({ name, size: st.size, createdAt: st.mtimeMs });
  }
  // Names sort chronologically, which is more reliable than mtime after a copy.
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

export async function deleteBackup(dataDir: string, name: string) {
  const file = backupFile(dataDir, name);
  if (!fs.existsSync(file)) throw new ApiError(404, "not_found", "Backup not found");
  await fs.promises.rm(file);
}

/** Keeps the newest `keep` backups and deletes the rest; returns the deleted names. */
export async function pruneBackups(dataDir: string, keep: number): Promise<string[]> {
  const old = (await listBackups(dataDir)).slice(Math.max(1, keep));
  for (const b of old) await fs.promises.rm(path.join(backupDir(dataDir), b.name), { force: true });
  return old.map((b) => b.name);
}

let running = false;

export async function createBackup(db: Db, dataDir: string, version: string, keep: number, now = new Date()): Promise<BackupInfo> {
  if (running) throw new ApiError(409, "backup_running", "A backup is already running");
  running = true;
  const tmp = path.join(dataDir, "tmp");
  const snapshot = path.join(tmp, `snapshot-${process.pid}-${Date.now()}.db`);
  try {
    await fs.promises.mkdir(tmp, { recursive: true });
    await fs.promises.mkdir(backupDir(dataDir), { recursive: true });
    // VACUUM INTO writes a consistent, defragmented copy without blocking readers or needing the WAL.
    await db.run(sql.raw(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`));
    const rows = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM __drizzle_migrations`).catch(() => [{ n: migrationCount() }]);
    const manifest: Manifest = {
      format: MANIFEST_FORMAT,
      appVersion: version,
      schemaMigrations: Number(rows[0]?.n ?? migrationCount()),
      createdAt: now.toISOString(),
    };
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(".", "");
    const name = `meally-${stamp}.zip`;
    const final = path.join(backupDir(dataDir), name);
    const partial = `${final}.partial`;
    await writeZipFile(partial, async (z) => {
      z.addBuffer("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
      await z.addFile("meally.db", snapshot);
      await z.addDir("images", path.join(dataDir, "images"));
    });
    await fs.promises.rename(partial, final);
    await pruneBackups(dataDir, keep);
    const st = await fs.promises.stat(final);
    return { name, size: st.size, createdAt: st.mtimeMs };
  } finally {
    running = false;
    await fs.promises.rm(snapshot, { force: true });
  }
}

/** Simple in-process timer. The first run is queued shortly after start if the newest backup is older than the interval. */
export function startBackupScheduler(opts: {
  db: Db;
  dataDir: string;
  version: string;
  settings: BackupSettings;
  enabled: () => Promise<boolean>;
  log?: (msg: string) => void;
}): () => void {
  const { settings } = opts;
  if (settings.hours <= 0) return () => {};
  const log = opts.log ?? ((m) => console.log(m));
  const every = settings.hours * 3_600_000;
  const run = async () => {
    try {
      if (!(await opts.enabled())) return;
      const b = await createBackup(opts.db, opts.dataDir, opts.version, settings.keep);
      log(`Scheduled backup written: ${b.name}`);
    } catch (e) {
      log(`Scheduled backup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const interval = setInterval(run, every);
  interval.unref();
  let first: NodeJS.Timeout | null = null;
  void listBackups(opts.dataDir).then((l) => {
    if (!l[0] || Date.now() - l[0].createdAt >= every) {
      first = setTimeout(run, 30_000);
      first.unref();
    }
  });
  return () => {
    clearInterval(interval);
    if (first) clearTimeout(first);
  };
}
