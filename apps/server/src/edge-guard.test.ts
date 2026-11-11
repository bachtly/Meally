import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build script
import { buildEdge } from "../scripts/build-edge.mjs";

type Meta = { inputs: Record<string, unknown>; outputs: Record<string, { imports: { path: string; external?: boolean }[] }> };

/** Everything the edge bundle may import from the runtime: WebCrypto-era Node shims that Deno supports, and postgres-js. */
const ALLOWED_EXTERNAL = [/^node:crypto$/, /^node:buffer$/, /^npm:postgres@/];
const FORBIDDEN_INPUT = [
  /node_modules\/sharp\//,
  /node_modules\/@electric-sql\//,
  /node_modules\/(busboy|yauzl|better-sqlite3|@libsql)\//,
  /node_modules\/@hono\/node-server\//,
  /node_modules\/drizzle-orm\/(pglite|libsql)/,
  /src\/adapters\/node\//,
  /src\/db\/index\.ts$/,
  /src\/app\.ts$/,
  /src\/features\/(import-files|backups\/(routes|service|zipfile))/,
];

describe("edge import boundary", () => {
  it("keeps Node-only code out of the edge bundle's input graph", async () => {
    const { metafile } = (await buildEdge({ write: false })) as { metafile: Meta };
    const inputs = Object.keys(metafile.inputs).map((p) => p.replaceAll("\\", "/"));
    expect(inputs.some((p) => p.endsWith("src/entry-edge.ts"))).toBe(true);
    expect(inputs.filter((p) => FORBIDDEN_INPUT.some((re) => re.test(p)))).toEqual([]);
    const external = Object.values(metafile.outputs).flatMap((o) => o.imports.filter((i) => i.external).map((i) => i.path));
    expect(external.filter((p) => !ALLOWED_EXTERNAL.some((re) => re.test(p)))).toEqual([]);
    expect(external.some((p) => p.startsWith("npm:postgres@"))).toBe(true);
  }, 60_000);
});
