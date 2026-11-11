import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { imageSizes, type ImageSize } from "@meally/shared";
import type { ImageStore, StoredImage } from "../../ports/index.js";

export const imagePath = (dataDir: string, householdId: string, id: string, size: ImageSize) =>
  path.join(dataDir, "images", householdId, `${id}-${size}.webp`);

/** Disk store under `<dataDir>/images/<household>/<id>-<size>.webp`; originals are resized with sharp. */
export function createDiskImageStore(dataDir: string): ImageStore {
  const store: ImageStore = {
    localDir: path.join(dataDir, "images"),
    async putOriginal(householdId, original) {
      const { default: sharp } = await import("sharp");
      const id = randomUUID();
      try {
        await Promise.all(
          imageSizes.map(async (size) => {
            const out = await sharp(original, { limitInputPixels: 100_000_000 })
              .rotate()
              .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer();
            await store.put(householdId, id, size, out, "image/webp");
          }),
        );
      } catch (e) {
        await store.delete(householdId, id);
        throw e;
      }
      return id;
    },
    async put(householdId, imageId, size, bytes) {
      const file = imagePath(dataDir, householdId, imageId, size);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
    },
    async get(householdId, imageId, size): Promise<StoredImage | null> {
      const data = await fs.readFile(imagePath(dataDir, householdId, imageId, size)).catch(() => null);
      return data ? { bytes: new Uint8Array(data), contentType: "image/webp" } : null;
    },
    async delete(householdId, imageId) {
      await Promise.all(imageSizes.map((s) => fs.rm(imagePath(dataDir, householdId, imageId, s), { force: true })));
    },
    async urlFor() {
      return null;
    },
  };
  return store;
}
