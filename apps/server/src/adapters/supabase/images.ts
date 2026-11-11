import { randomUUID } from "node:crypto";
import { imageSizes, type ImageSize } from "@meally/shared";
import { ApiError } from "../../lib/errors.js";
import type { ImageStore, StoredImage } from "../../ports/index.js";

export const IMAGE_BUCKET = "meally-images";

export interface SupabaseImageOptions {
  /** `SUPABASE_URL`, e.g. https://<ref>.supabase.co (injected into Edge Functions). */
  url: string;
  /** `SUPABASE_SERVICE_ROLE_KEY` (injected into Edge Functions). Never sent to the browser. */
  serviceKey: string;
  bucket?: string;
  fetch?: typeof fetch;
}

/**
 * Object path: `<householdId>/<imageId>-<size>`. No extension: a size may be WebP or JPEG (Safari cannot
 * encode WebP), and Storage keeps the real Content-Type with the object and serves it on signed URLs.
 */
export const objectPath = (householdId: string, imageId: string, size: ImageSize) => `${householdId}/${imageId}-${size}`;

/**
 * Private Supabase Storage bucket through the plain REST API (no SDK). The server checks household
 * ownership and then streams the bytes from the authenticated endpoint, so tenant isolation stays in our code and
 * the image URL is stable (cacheable by the browser and the service worker).
 * Browsers resize before upload (the edge has no sharp), so `putOriginal` is not supported.
 * The three sizes upload in parallel; if any fails, the rest are removed once every upload has settled.
 */
export function createSupabaseImageStore(opts: SupabaseImageOptions): ImageStore {
  const base = `${opts.url.replace(/\/+$/, "")}/storage/v1`;
  const bucket = opts.bucket ?? IMAGE_BUCKET;
  const doFetch = opts.fetch ?? ((i, init) => fetch(i, init));
  const headers = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${opts.serviceKey}`, apikey: opts.serviceKey, ...extra });
  const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const fail = (what: string, status: number): never => {
    throw new ApiError(502, "storage_error", `Image storage ${what} failed (${status})`);
  };

  const store: ImageStore = {
    acceptsPresized: true,
    async putOriginal() {
      throw new ApiError(415, "unsupported_media", "This server stores browser-resized images; update the app and try again");
    },
    async putSized(householdId, sizes) {
      const id = randomUUID();
      const results = await Promise.allSettled(imageSizes.map((size) => store.put(householdId, id, size, sizes[size].bytes, sizes[size].contentType)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) {
        await store.delete(householdId, id).catch(() => {});
        throw failed.reason;
      }
      return id;
    },
    async put(householdId, imageId, size, bytes, contentType) {
      const res = await doFetch(`${base}/object/${bucket}/${enc(objectPath(householdId, imageId, size))}`, {
        method: "POST",
        headers: headers({ "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "max-age=31536000" }),
        body: bytes as Uint8Array<ArrayBuffer>,
      });
      if (!res.ok) fail("upload", res.status);
    },
    async get(householdId, imageId, size): Promise<StoredImage | null> {
      const res = await doFetch(`${base}/object/authenticated/${bucket}/${enc(objectPath(householdId, imageId, size))}`, { headers: headers() });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) fail("download", res.status);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "image/webp" };
    },
    async delete(householdId, imageId) {
      const prefixes = imageSizes.map((s) => objectPath(householdId, imageId, s));
      const res = await doFetch(`${base}/object/${bucket}`, {
        method: "DELETE",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefixes }),
      });
      if (!res.ok && res.status !== 404) fail("delete", res.status);
    },
  };
  return store;
}
