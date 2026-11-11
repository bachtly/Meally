import type { Context } from "hono";

/** JSON response with a weak ETag over the body; `If-None-Match` matches answer 304 with no body. */
export async function jsonWithEtag(c: Context, data: unknown): Promise<Response> {
  const text = JSON.stringify(data);
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  const etag = `W/"${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}"`;
  const inm = c.req.header("if-none-match");
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === etag.slice(2))) return c.body(null, 304, headers);
  return c.body(text, 200, { ...headers, "Content-Type": "application/json; charset=UTF-8" });
}
