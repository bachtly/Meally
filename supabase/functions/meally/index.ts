// Thin Deno entry. `meally.js` is the esbuild bundle copied here by scripts/deploy.sh (npm run build:edge -w
// apps/server, then a copy of apps/server/dist-edge/meally.js); it is gitignored.
// The Supabase Edge Runtime does not allow Deno.env.set, so defaults are passed to the app as an env object.
declare const Deno: {
  env: { toObject(): Record<string, string | undefined> };
  serve(h: (req: Request) => Response | Promise<Response>): unknown;
};

const { createEdgeApp } = await import("./meally.js");

// Supabase serves this function under /functions/v1/meally and keeps "/meally" in the request path.
const env = { MEALLY_BASE_PATH: "/meally", ...Deno.env.toObject(), MEALLY_PLATFORM: "supabase" };
let app: { fetch(req: Request): Response | Promise<Response> } | undefined;

Deno.serve((req) => (app ??= createEdgeApp(env)).fetch(req));
