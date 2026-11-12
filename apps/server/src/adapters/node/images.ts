import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { imageSizes, type ImageSize } from "@meally/shared";
import { ApiError } from "../../lib/errors.js";
import type { ImageStore, StoredImage } from "../../ports/index.js";

export const imagePath = (dataDir: string, userId: string, id: string, size: ImageSize) =>
  path.join(dataDir, "images", userId, `${id}-${size}.webp`);

/** Disk store under `<dataDir>/images/<userId>/<id>-<size>.webp`; originals are resized with sharp. */
export function createDiskImageStore(dataDir: string): ImageStore {
  const store: ImageStore = {
    acceptsPresized: false,
    async putSized(userId, sizes) {
      // Files here are always `.webp`; this store resizes originals itself, so it never asks for JPEG parts.
      if (imageSizes.some((s) => sizes[s].contentType !== "image/webp")) throw new ApiError(415, "unsupported_media", "Send the image as the 'file' field");
      const id = randomUUID();
      const results = await Promise.allSettled(imageSizes.map((size) => store.put(userId, id, size, sizes[size].bytes, "image/webp")));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) {
        await store.delete(userId, id);
        throw failed.reason;
      }
      return id;
    },
    localDir: path.join(dataDir, "images"),
    async putOriginal(userId, original) {
      const { default: sharp } = await import("sharp");
      const id = randomUUID();
      try {
        await Promise.all(
          imageSizes.map(async (size) => {
            const out = await sharp(original, { limitInputPixels: 100_000_000 })
              .rotate()
              .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
              .webp({ quality: 88 })
              .toBuffer();
            await store.put(userId, id, size, out, "image/webp");
          }),
        );
      } catch (e) {
        await store.delete(userId, id);
        throw e;
      }
      return id;
    },
    async put(userId, imageId, size, bytes) {
      const file = imagePath(dataDir, userId, imageId, size);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
    },
    async get(userId, imageId, size): Promise<StoredImage | null> {
      const data = await fs.readFile(imagePath(dataDir, userId, imageId, size)).catch(() => null);
      return data ? { bytes: new Uint8Array(data), contentType: "image/webp" } : null;
    },
    async moveOwner(fromOwnerId, toOwnerId) {
      const from = path.join(dataDir, "images", fromOwnerId);
      const to = path.join(dataDir, "images", toOwnerId);
      const names = await fs.readdir(from).catch(() => [] as string[]);
      if (names.length === 0) return 0;
      await fs.mkdir(to, { recursive: true });
      for (const name of names) {
        const dest = path.join(to, name);
        // An existing destination was fully copied by an earlier, interrupted run.
        // Copy to a temp name, then rename: a crash mid-copy never leaves a partial file at the destination.
        if (!(await fs.stat(dest).catch(() => null))) {
          const part = `${dest}.${randomUUID()}.tmp`;
          await fs.copyFile(path.join(from, name), part);
          await fs.rename(part, dest);
        }
        await fs.rm(path.join(from, name), { force: true });
      }
      await fs.rmdir(from).catch(() => {});
      return names.length;
    },
    async delete(userId, imageId) {
      await Promise.all(imageSizes.map((s) => fs.rm(imagePath(dataDir, userId, imageId, s), { force: true })));
    },
  };
  return store;
}
