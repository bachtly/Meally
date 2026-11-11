import type { Context } from "hono";
import { imageSizes, type ImageSize } from "@meally/shared";
import { ApiError } from "../../lib/errors.js";
import type { ImageStore } from "../../ports/index.js";
import type { AppEnv } from "../../lib/context.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Pre-sized WebP parts are small; 2 MB each is far above a 1600 px WebP. */
export const MAX_SIZED_BYTES = 2 * 1024 * 1024;

export type ImageInput = { kind: "original"; bytes: Buffer } | { kind: "sized"; sizes: Record<ImageSize, Uint8Array> };

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const isWebp = (b: Uint8Array) => b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP";
const bad = (msg: string, status: 400 | 413 | 415 = 400) =>
  new ApiError(status, status === 413 ? "too_large" : status === 415 ? "unsupported_media" : "invalid_body", msg);

/**
 * Reads a multipart image upload: either a single `file` original, or the three pre-sized WebP parts
 * `w320`, `w800` and `w1600`. Pre-sized parts are only accepted when the image store asks for them.
 */
export async function readImageUpload(c: Context<AppEnv>): Promise<ImageInput> {
  const store = c.get("platform").images;
  const form = await c.req.parseBody().catch(() => null);
  const parts = imageSizes.map((s) => form?.[`w${s}`]);
  if (parts.some((p) => p !== undefined)) {
    if (!store.acceptsPresized) throw bad("Send the image as the 'file' field");
    const sizes = {} as Record<ImageSize, Uint8Array>;
    for (const [i, size] of imageSizes.entries()) {
      const part = parts[i];
      if (!(part instanceof File)) throw bad(`Attach all of ${imageSizes.map((s) => `w${s}`).join(", ")}`);
      if (part.size > MAX_SIZED_BYTES) throw bad("Resized image is too large", 413);
      if (part.type !== "image/webp") throw bad("Resized images must be WebP", 415);
      const bytes = new Uint8Array(await part.arrayBuffer());
      if (!isWebp(bytes)) throw bad("Resized images must be WebP", 415);
      sizes[size] = bytes;
    }
    return { kind: "sized", sizes };
  }
  const file = form?.file;
  if (!(file instanceof File)) throw bad("Attach an image as the 'file' field");
  if (file.size > MAX_IMAGE_BYTES) throw bad("Image must be 10 MB or smaller", 413);
  if (!file.type.startsWith("image/")) throw bad("Only image files are allowed", 415);
  return { kind: "original", bytes: Buffer.from(await file.arrayBuffer()) };
}

/** Stores an upload and returns the new image id. Unreadable originals surface as 415. */
export async function storeImage(store: ImageStore, householdId: string, input: ImageInput | Buffer): Promise<string> {
  try {
    if (Buffer.isBuffer(input)) return await store.putOriginal(householdId, input);
    return input.kind === "sized" ? await store.putSized(householdId, input.sizes) : await store.putOriginal(householdId, input.bytes);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw bad("That file is not a readable image", 415);
  }
}
