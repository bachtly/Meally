import { Buffer } from "node:buffer";
import { ApiError } from "../../lib/errors.js";
import { isBlockedIp, isIP } from "./ssrf.js";

export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 10_000;
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface FetchResult {
  body: Buffer;
  contentType: string;
  finalUrl: string;
  /** HTTP status; always set for `post` requests, which return any non-redirect answer. */
  status?: number;
}
export interface FetchOptions {
  /** `post` sends `body` with `headers` and never follows redirects (used by webhooks). */
  kind: "html" | "image" | "post";
  body?: string;
  headers?: Record<string, string>;
}

/** MEALLY_ALLOW_PRIVATE_URLS, or its older name MEALLY_IMPORT_ALLOW_PRIVATE. */
export const allowPrivateUrls = (env: Record<string, string | undefined>) =>
  env.MEALLY_ALLOW_PRIVATE_URLS === "true" || env.MEALLY_IMPORT_ALLOW_PRIVATE === "true";
/** Fetches a public web resource safely; replaceable in tests. */
export type Fetcher = (url: string, opts: FetchOptions) => Promise<FetchResult>;

export interface TransportRequest {
  url: URL;
  method?: "GET" | "POST";
  body?: string;
  /** The vetted address to connect to. */
  ip: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Buffer>;
  destroy(): void;
}
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface FetcherDeps {
  allowPrivate?: boolean;
  version?: string;
  /** DNS lookup. When omitted, hostnames are vetted by name only (edge: no DNS API, no raw sockets). */
  resolve?: (host: string) => Promise<string[]>;
  transport?: Transport;
}

const blocked = (msg = "That address is not allowed") => new ApiError(400, "blocked_url", msg);
const failed = (msg: string) => new ApiError(502, "fetch_failed", msg);

/**
 * Default transport for runtimes without raw sockets (edge): plain fetch. It cannot pin the vetted IP,
 * so private ranges are only blocked by hostname there (see `vet`); the edge sandbox has no private network.
 */
const fetchTransport: Transport = async ({ url, headers, signal, method = "GET", body }) => {
  const res = await fetch(url, { method, headers, signal, body, redirect: "manual" });
  const h: Record<string, string | undefined> = {};
  res.headers.forEach((v, k) => (h[k] = v));
  const reader = res.body?.getReader();
  return {
    status: res.status,
    headers: h,
    body: (async function* () {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) return;
        yield Buffer.from(value);
      }
    })(),
    destroy: () => void res.body?.cancel().catch(() => {}),
  };
};

export function checkUrlShape(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blocked("That is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw blocked("Only http and https links are allowed");
  if (url.username || url.password) throw blocked("Links with a username or password are not allowed");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!allowPrivate && port !== 80 && port !== 443) throw blocked("Only ports 80 and 443 are allowed");
  return url;
}

export function createFetcher(deps: FetcherDeps = {}): Fetcher {
  const allowPrivate = deps.allowPrivate ?? false;
  const resolve = deps.resolve;
  const transport = deps.transport ?? fetchTransport;
  const ua = `Meally/${deps.version ?? "0.0.0"} (+recipe import)`;

  async function vet(url: URL): Promise<string> {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let ips: string[];
    if (isIP(host)) ips = [host];
    else if (!resolve) {
      if (!allowPrivate && (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host))) throw blocked();
      return host;
    } else {
      try {
        ips = await resolve(host);
      } catch {
        throw failed("Could not find that site");
      }
    }
    if (!ips.length) throw failed("Could not find that site");
    if (!allowPrivate && ips.some(isBlockedIp)) throw blocked();
    return ips[0]!;
  }

  return async (raw, { kind, body, headers: extra }) => {
    const max = kind === "html" ? MAX_HTML_BYTES : MAX_IMAGE_BYTES;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let current = checkUrlShape(raw, allowPrivate);
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const ip = await vet(current);
        let res: TransportResponse;
        try {
          res = await transport({
            url: current,
            ip,
            signal: ctl.signal,
            ...(kind === "post" ? { method: "POST" as const, body } : {}),
            headers: {
              "User-Agent": ua,
              Accept: kind === "html" ? "text/html,application/xhtml+xml" : kind === "post" ? "*/*" : "image/*",
              "Accept-Encoding": "identity",
              ...(kind === "post" ? { ...extra, "Content-Length": String(Buffer.byteLength(body ?? "")) } : {}),
            },
          });
        } catch {
          throw failed(ctl.signal.aborted ? "The site took too long to respond" : "Could not reach that site");
        }
        if (kind === "post") {
          res.destroy(); // the answer body is not needed; redirects are reported, not followed
          return { body: Buffer.alloc(0), contentType: "", finalUrl: current.href, status: res.status };
        }
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          res.destroy();
          const loc = res.headers.location;
          if (!loc) throw failed("The site sent a bad redirect");
          try {
            current = checkUrlShape(new URL(loc, current).href, allowPrivate); // each hop is re-validated
          } catch (e) {
            if (e instanceof ApiError) throw e;
            throw failed("The site sent a bad redirect");
          }
          continue;
        }
        if (res.status < 200 || res.status >= 300) {
          res.destroy();
          throw failed(`The site answered with status ${res.status}`);
        }
        const contentType = (res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        const okType =
          kind === "html" ? contentType === "text/html" || contentType === "application/xhtml+xml" : contentType.startsWith("image/");
        if (!okType) {
          res.destroy();
          throw failed(kind === "html" ? "That link is not a web page" : "That link is not an image");
        }
        const declared = Number(res.headers["content-length"]);
        if (declared > max) {
          res.destroy();
          throw failed("That page is too large");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for await (const chunk of res.body) {
            size += chunk.length;
            if (size > max) {
              res.destroy();
              throw failed("That page is too large");
            }
            chunks.push(chunk);
          }
        } catch (e) {
          if (e instanceof ApiError) throw e;
          throw failed(ctl.signal.aborted ? "The site took too long to respond" : "The connection dropped");
        }
        return { body: Buffer.concat(chunks), contentType, finalUrl: current.href };
      }
      throw failed("Too many redirects");
    } finally {
      clearTimeout(timer);
    }
  };
}
