import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createFetcher, type FetcherDeps, type Fetcher, type Transport } from "./fetch.js";

export const nodeResolve = async (host: string) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Connects to the already-vetted IP, so a second DNS answer cannot redirect us (DNS rebinding). */
export const nodeTransport: Transport = ({ url, ip, headers, signal, method = "GET", body }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method,
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
    req.end(body);
  });

/** The server's fetcher: DNS-resolves, vets every address and connects to the vetted IP. */
export function createNodeFetcher(deps: FetcherDeps = {}): Fetcher {
  return createFetcher({ resolve: nodeResolve, transport: nodeTransport, ...deps });
}
