import yauzl from "yauzl";
import { ApiError } from "../../lib/errors.js";

export const ZIP_LIMITS = { maxEntries: 5000, maxTotalBytes: 500 * 1024 * 1024 };

export interface ZipItem {
  /** Normalised path with forward slashes. */
  name: string;
  size: number;
  entry: yauzl.Entry;
}

const bad = (msg: string) => new ApiError(400, "invalid_archive", msg);

/** Rejects absolute paths, drive letters, NUL bytes and ".." segments. Nothing is ever extracted to disk. */
export function safeEntryName(raw: string): string {
  const name = raw.replaceAll("\\", "/");
  if (name.includes("\0") || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.split("/").includes("..")) {
    throw bad("The archive contains an unsafe file path");
  }
  return name;
}

export class ZipArchive {
  constructor(
    private zip: yauzl.ZipFile,
    readonly items: ZipItem[],
  ) {}

  /** Reads one entry fully into memory, refusing anything over `max` bytes. */
  read(item: ZipItem, max = 50 * 1024 * 1024): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (item.size > max) return reject(bad(`${item.name} is too large`));
      this.zip.openReadStream(item.entry, (err, stream) => {
        if (err || !stream) return reject(err ?? bad("Could not read the archive"));
        const chunks: Buffer[] = [];
        let n = 0;
        stream.on("data", (d: Buffer) => {
          n += d.length;
          if (n > max) {
            stream.destroy();
            reject(bad(`${item.name} is too large`));
          } else chunks.push(d);
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks)));
      });
    });
  }

  close() {
    this.zip.close();
  }
}

/** Opens a zip from disk and checks it against the safety limits using the central directory only. */
export function openZip(file: string): Promise<ZipArchive> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true, decodeStrings: true }, (err, zip) => {
      if (err || !zip) return reject(bad("That file is not a valid zip archive"));
      const items: ZipItem[] = [];
      let total = 0;
      const fail = (e: unknown) => {
        zip.close();
        reject(e instanceof ApiError ? e : bad("That file is not a valid zip archive"));
      };
      if (zip.entryCount > ZIP_LIMITS.maxEntries) return fail(bad(`The archive has more than ${ZIP_LIMITS.maxEntries} files`));
      zip.on("error", fail);
      zip.on("end", () => resolve(new ZipArchive(zip, items)));
      zip.on("entry", (entry: yauzl.Entry) => {
        try {
          const name = safeEntryName(entry.fileName);
          if (!name.endsWith("/")) {
            total += entry.uncompressedSize;
            if (total > ZIP_LIMITS.maxTotalBytes) throw bad("The archive is too large when unpacked (limit 500 MB)");
            items.push({ name, size: entry.uncompressedSize, entry });
          }
          zip.readEntry();
        } catch (e) {
          fail(e);
        }
      });
      zip.readEntry();
    });
  });
}
