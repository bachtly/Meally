// Forwards /api/* from Cloudflare Pages to the Supabase Edge Function, so the browser sees one origin and the
// session cookie stays first-party. Pages `_redirects` can only proxy to paths on the same site, so this is a
// Pages Function (functions/api/[[path]].ts). Kept free of Workers types so Vitest can run it on Node.

/** `base` is `https://<ref>.supabase.co/functions/v1/meally` (scripts/render-pages.mjs). Keeps the path (`/api/v1/...`) and query string; the function serves the app under `/meally`. */
export function upstreamUrl(requestUrl: string, base: string): string {
  const u = new URL(requestUrl);
  return `${base}${u.pathname}${u.search}`;
}

export function proxy(request: Request, base: string, send: typeof fetch = fetch): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("host");
  // The app reads the first X-Forwarded-For entry when it trusts the proxy (rate limits).
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set("x-forwarded-for", ip);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    // Image routes answer with a redirect to a signed Storage URL; the browser must follow it, not the proxy.
    redirect: "manual",
    ...(hasBody ? { body: request.body, duplex: "half" } : {}),
  };
  return send(upstreamUrl(request.url, base), init);
}
