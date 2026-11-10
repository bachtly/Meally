import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { ApiError } from "../../lib/errors.js";
import { isBlockedIp } from "./ssrf.js";

export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 10_000;
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface FetchResult {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}
export interface FetchOptions {
  kind: "html" | "image";
}
/** Fetches a public web resource safely; replaceable in tests. */
export type Fetcher = (url: string, opts: FetchOptions) => Promise<FetchResult>;

export interface TransportRequest {
  url: URL;
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
  resolve?: (host: string) => Promise<string[]>;
  transport?: Transport;
}

const blocked = (msg = "That address is not allowed") => new ApiError(400, "blocked_url", msg);
const failed = (msg: string) => new ApiError(502, "fetch_failed", msg);

const defaultResolve = async (host: string) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Connects to the already-vetted IP, so a second DNS answer cannot redirect us (DNS rebinding). */
const defaultTransport: Transport = ({ url, ip, headers, signal }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        headers,
        signal,
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          o?.all ? cb(null, [{ address: ip, family: net.isIP(ip) }]) : cb(null, ip, net.isIP(ip))) as never,
      },
      (res) => {
        const h: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) h[k] = Array.isArray(v) ? v[0] : v;
        resolve({
          status: res.statusCode ?? 0,
          headers: h,
          body: res as AsyncIterable<Buffer>,
          destroy: () => res.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

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
  const resolve = deps.resolve ?? defaultResolve;
  const transport = deps.transport ?? defaultTransport;
  const ua = `Meally/${deps.version ?? "0.0.0"} (+recipe import)`;

  async function vet(url: URL): Promise<string> {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let ips: string[];
    if (net.isIP(host)) ips = [host];
    else {
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

  return async (raw, { kind }) => {
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
            headers: {
              "User-Agent": ua,
              Accept: kind === "html" ? "text/html,application/xhtml+xml" : "image/*",
              "Accept-Encoding": "identity",
            },
          });
        } catch {
          throw failed(ctl.signal.aborted ? "The site took too long to respond" : "Could not reach that site");
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
