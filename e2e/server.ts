import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface RunningServer {
  url: string;
  dataDir: string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

/** Starts the production server on a random port with a throwaway DATA_DIR. */
export async function startServer(extraEnv: Record<string, string> = {}): Promise<RunningServer> {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-e2e-"));
  const url = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(process.execPath, [path.join(root, "apps/server/dist/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATA_DIR: dataDir,
      BASE_URL: url,
      MEALLY_BACKUP_CRON_HOURS: "0",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  let exited = false;
  child.once("exit", () => (exited = true));

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (exited) throw new Error(`Server exited early:\n${log}`);
    try {
      if ((await fetch(`${url}/api/v1/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`Server did not become healthy:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    url,
    dataDir,
    async stop() {
      if (!exited) {
        const done = new Promise((r) => child.once("exit", r));
        child.kill();
        await Promise.race([done, new Promise((r) => setTimeout(r, 5000))]);
      }
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

export const ADMIN = { name: "Ada Admin", email: "ada@example.com", password: "correct-horse-battery" };

const headers = { "content-type": "application/json", "x-requested-with": "meally" };

/** Creates the first admin through the API and returns the session cookie. */
export async function setupAdmin(url: string): Promise<string> {
  const res = await fetch(`${url}/api/v1/auth/setup`, { method: "POST", headers, body: JSON.stringify(ADMIN) });
  if (!res.ok) throw new Error(`setup failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("setup returned no session cookie");
  return cookie;
}

export async function apiPost<T>(url: string, cookie: string, apiPath: string, body: unknown): Promise<T> {
  const res = await fetch(`${url}/api/v1${apiPath}`, { method: "POST", headers: { ...headers, cookie }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${apiPath} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function seedRecipe(url: string, cookie: string, name: string) {
  return apiPost<{ slug: string }>(url, cookie, "/recipes", {
    name,
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    ingredients: [
      { raw: "2 cups flour", quantity: 2, unit: "cup", food: "flour" },
      { raw: "1 lb butter", quantity: 1, unit: "lb", food: "butter" },
      { raw: "3 eggs", quantity: 3, unit: null, food: "eggs" },
    ],
    steps: [{ text: "Mix the flour and butter." }, { text: "Fold in the eggs." }, { text: "Bake until golden." }],
  });
}

export function cookiesFor(cookie: string, url: string) {
  return cookie.split("; ").map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1), url }));
}
