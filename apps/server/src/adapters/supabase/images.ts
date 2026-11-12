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
 * Object path: `<userId>/<imageId>-<size>`. No extension: a size may be WebP or JPEG (Safari cannot
 * encode WebP), and Storage keeps the real Content-Type with the object and serves it on signed URLs.
 */
export const objectPath = (userId: string, imageId: string, size: ImageSize) => `${userId}/${imageId}-${size}`;

/**
 * Private Supabase Storage bucket through the plain REST API (no SDK). The server checks user
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
    async putSized(userId, sizes) {
      const id = randomUUID();
      const results = await Promise.allSettled(imageSizes.map((size) => store.put(userId, id, size, sizes[size].bytes, sizes[size].contentType)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) {
        await store.delete(userId, id).catch(() => {});
        throw failed.reason;
      }
      return id;
    },
    async put(userId, imageId, size, bytes, contentType) {
      const res = await doFetch(`${base}/object/${bucket}/${enc(objectPath(userId, imageId, size))}`, {
        method: "POST",
        headers: headers({ "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "max-age=31536000" }),
        body: bytes as Uint8Array<ArrayBuffer>,
      });
      if (!res.ok) fail("upload", res.status);
    },
    async get(userId, imageId, size): Promise<StoredImage | null> {
      const res = await doFetch(`${base}/object/authenticated/${bucket}/${enc(objectPath(userId, imageId, size))}`, { headers: headers() });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) fail("download", res.status);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "image/webp" };
    },
    async moveOwner(fromOwnerId, toOwnerId) {
      let moved = 0;
      // Listing returns at most `limit` names; each pass deletes what it copied, so repeat until nothing is left.
      for (;;) {
        const list = await doFetch(`${base}/object/list/${bucket}`, {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prefix: fromOwnerId, limit: 100, offset: 0 }),
        });
        if (!list.ok) fail("list", list.status);
        const names = ((await list.json()) as Array<{ name: string }>).map((o) => o.name).filter(Boolean);
        if (names.length === 0) return moved;
        for (const name of names) {
          const copy = await doFetch(`${base}/object/copy`, {
            method: "POST",
            headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ bucketId: bucket, sourceKey: `${fromOwnerId}/${name}`, destinationKey: `${toOwnerId}/${name}` }),
          });
          if (!copy.ok) {
            // 400/409 can mean the destination already exists (an earlier interrupted run). Never trust the status
            // alone: delete the source only once the destination is confirmed to be there.
            if (copy.status !== 400 && copy.status !== 409) fail("copy", copy.status);
            const there = await doFetch(`${base}/object/authenticated/${bucket}/${enc(`${toOwnerId}/${name}`)}`, { headers: headers() });
            if (!there.ok) fail("copy", copy.status);
          }
        }
        const del = await doFetch(`${base}/object/${bucket}`, {
          method: "DELETE",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prefixes: names.map((n) => `${fromOwnerId}/${n}`) }),
        });
        if (!del.ok && del.status !== 404) fail("delete", del.status);
        moved += names.length;
      }
    },
    async delete(userId, imageId) {
      const prefixes = imageSizes.map((s) => objectPath(userId, imageId, s));
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
