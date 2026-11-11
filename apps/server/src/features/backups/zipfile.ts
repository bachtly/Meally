import fs from "node:fs";
import path from "node:path";
import { ZipWriter } from "./zipwriter.js";

/** Streams a file from disk in 256 KB chunks so large databases never sit in memory. */
export async function addFile(z: ZipWriter, name: string, file: string, store = false) {
  const f = z.open(name, store);
  const fh = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.allocUnsafe(256 * 1024);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      f.push(new Uint8Array(buf.subarray(0, bytesRead)), false);
      await z.drain();
    }
    f.push(new Uint8Array(0), true);
  } finally {
    await fh.close();
  }
}

/** Adds every regular file under `dir` as `prefix/<relative path>`. */
export async function addDir(z: ZipWriter, prefix: string, dir: string) {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await addDir(z, `${prefix}/${e.name}`, full);
    else if (e.isFile()) await addFile(z, `${prefix}/${e.name}`, full, /\.(webp|jpe?g|png|gif)$/i.test(e.name));
  }
}

/** A zip written to a file, with backpressure. Resolves when the file is fully flushed. */
export async function writeZipFile(file: string, build: (z: ZipWriter) => Promise<void>): Promise<void> {
  const out = fs.createWriteStream(file);
  const done = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
  done.catch(() => {});
  let full = false;
  const z = new ZipWriter(
    (chunk) => {
      if (!out.write(chunk)) full = true;
    },
    async () => {
      if (full) {
        full = false;
        await new Promise<void>((r) => out.once("drain", () => r()));
      }
    },
  );
  try {
    await build(z);
    z.end();
    out.end();
    await done;
  } catch (e) {
    out.destroy();
    await fs.promises.rm(file, { force: true });
    throw e;
  }
}

