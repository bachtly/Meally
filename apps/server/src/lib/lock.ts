import fs from "node:fs";
import path from "node:path";

export const lockPath = (dataDir: string) => path.join(dataDir, "meally.lock");

/** True when the lock names a live process other than us. A stale lock (dead pid) does not count. */
export function isLocked(dataDir: string): boolean {
  let pid: number;
  try {
    pid = parseInt(fs.readFileSync(lockPath(dataDir), "utf8"), 10);
  } catch {
    return false;
  }
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Writes the lock for this process and removes it on exit. */
export function acquireLock(dataDir: string): () => void {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = lockPath(dataDir);
  fs.writeFileSync(file, String(process.pid));
  const release = () => {
    try {
      if (fs.readFileSync(file, "utf8") === String(process.pid)) fs.rmSync(file);
    } catch {
      /* already gone */
    }
  };
  process.on("exit", release);
  for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => process.exit(0));
  return release;
}
