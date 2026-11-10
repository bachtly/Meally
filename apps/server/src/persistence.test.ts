import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";

/** Smoke test: the real server entry point on PGlite-on-disk keeps its data across a hard kill and restart. */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-persist-"));
const procs: ChildProcess[] = [];
afterAll(async () => {
  for (const p of procs) p.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

async function start(port: number) {
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), NODE_ENV: "development", MEALLY_SIGNUP_MODE: "open", DATABASE_URL: "" };
  const p = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(p);
  let log = "";
  p.stdout.on("data", (d) => (log += String(d)));
  p.stderr.on("data", (d) => (log += String(d)));
  for (let i = 0; i < 300; i++) {
    if (p.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    if (log.includes("listening")) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${log}`);
}

const H = { "content-type": "application/json", "x-requested-with": "meally" };

it("keeps data on disk across a hard kill and restart", async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/api/v1`;
  const first = await start(port);
  const setup = await fetch(`${base}/auth/setup`, { method: "POST", headers: H, body: JSON.stringify({ email: "a@example.com", name: "A", password: "correct horse" }) });
  expect(setup.status).toBe(201);
  const cookie = setup.headers.get("set-cookie")!.split(";")[0]!;
  const made = await fetch(`${base}/recipes`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ name: "Survivor Soup", ingredients: [{ raw: "1 cup water" }], steps: [{ text: "Boil" }] }) });
  expect(made.status).toBe(201);

  first.kill("SIGKILL");
  await new Promise((r) => first.once("exit", r));

  await start(port);
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: H, body: JSON.stringify({ email: "a@example.com", password: "correct horse" }) });
  expect(login.status).toBe(200);
  const cookie2 = login.headers.get("set-cookie")!.split(";")[0]!;
  const list = (await (await fetch(`${base}/recipes?q=survivor`, { headers: { cookie: cookie2 } })).json()) as { items: { name: string }[] };
  expect(list.items.map((i) => i.name)).toEqual(["Survivor Soup"]);
}, 120_000);
