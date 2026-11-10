import fs from "node:fs";
import path from "node:path";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

type Sink = (chunk: Uint8Array, final: boolean) => void;

/** Streaming zip writer. Images are stored as they are (already compressed); everything else is deflated. */
export class ZipWriter {
  private zip: Zip;
  constructor(
    sink: Sink,
    private pause: () => Promise<void> = async () => {},
  ) {
    this.zip = new Zip((err, chunk, final) => {
      if (err) throw err;
      sink(chunk, final);
    });
  }

  addBuffer(name: string, data: Uint8Array, store = false) {
    const f = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    this.zip.add(f);
    f.push(data, true);
  }

  /** Streams a file from disk in 256 KB chunks so large databases never sit in memory. */
  async addFile(name: string, file: string, store = false) {
    const f = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    this.zip.add(f);
    const fh = await fs.promises.open(file, "r");
    try {
      const buf = Buffer.allocUnsafe(256 * 1024);
      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, buf.length, null);
        if (bytesRead === 0) break;
        f.push(new Uint8Array(buf.subarray(0, bytesRead)), false);
        await this.pause();
      }
      f.push(new Uint8Array(0), true);
    } finally {
      await fh.close();
    }
  }

  /** Adds every regular file under `dir` as `prefix/<relative path>`. */
  async addDir(prefix: string, dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await this.addDir(`${prefix}/${e.name}`, full);
      else if (e.isFile()) await this.addFile(`${prefix}/${e.name}`, full, /\.(webp|jpe?g|png|gif)$/i.test(e.name));
    }
  }

  end() {
    this.zip.end();
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

/** A zip as a web stream for an HTTP response. `build` runs while the client reads. */
export function zipResponseStream(build: (z: ZipWriter) => Promise<void>): ReadableStream<Uint8Array> {
  let resume: (() => void) | null = null;
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      const z = new ZipWriter(
        (chunk) => ctrl.enqueue(chunk),
        async () => {
          if ((ctrl.desiredSize ?? 1) <= 0) await new Promise<void>((r) => (resume = r));
        },
      );
      build(z)
        .then(() => {
          z.end();
          ctrl.close();
        })
        .catch((e) => ctrl.error(e));
    },
    pull() {
      resume?.();
      resume = null;
    },
    cancel() {
      resume?.();
    },
  });
}
