// Cloudflare Pages Function for /s/*: serves the SPA's index.html with Open Graph tags and, for a single recipe,
// schema.org Recipe JSON-LD, so chat apps show a rich preview and other recipe apps can import the link. Crawlers
// don't run JavaScript, so this has to happen on the edge. Best effort: any failure serves the plain page.
// Kept free of Workers types so Vitest can run it on Node (like proxy.ts).
import { injectShareHead, type ShareMeta } from "../../../packages/shared/src/share-head";

const SHARE_PATH = /^\/s\/([^/]+)(?:\/[^/]+)?\/?$/;

export async function sharePreview(request: Request, next: () => Promise<Response>, base: string, send: typeof fetch = fetch): Promise<Response> {
  const page = await next();
  const url = new URL(request.url);
  const m = SHARE_PATH.exec(url.pathname);
  const headers = new Headers(page.headers);
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  const plain = () => new Response(page.body, { status: page.status, headers });
  if (!m || !page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) return plain();
  let meta: ShareMeta;
  try {
    const ip = request.headers.get("cf-connecting-ip");
    const r = await send(`${base}/api/v1/public/shares/${m[1]}/meta`, {
      headers: { accept: "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return plain();
    meta = (await r.json()) as ShareMeta;
  } catch {
    return plain();
  }
  // The note and names are per link: never let a shared cache keep this HTML.
  headers.set("Cache-Control", "private, no-store");
  headers.delete("content-length");
  return new Response(injectShareHead(await page.text(), meta, url.origin, url.pathname), { status: page.status, headers });
}
