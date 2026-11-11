// Thin Deno entry. `meally.js` is the esbuild bundle copied here by scripts/deploy.sh (npm run build:edge,
// then a copy of apps/server/dist-edge/meally.js); it is gitignored.
declare const Deno: {
  env: { get(k: string): string | undefined; set(k: string, v: string): void };
  serve(h: (req: Request, ...rest: unknown[]) => Response | Promise<Response>): unknown;
};

// Supabase serves this function under /functions/v1/meally and keeps that prefix in the request path.
if (!Deno.env.get("MEALLY_BASE_PATH")) Deno.env.set("MEALLY_BASE_PATH", "/meally");
Deno.env.set("MEALLY_PLATFORM", "supabase");

const { fetch: handler } = await import("./meally.js");
Deno.serve(handler);
