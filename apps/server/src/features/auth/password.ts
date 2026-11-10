import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const R = 8;
const P = 1;
const KEYLEN = 32;

function derive(password: string, salt: Buffer, n: number): Promise<Buffer> {
  // Memory is 128 * N * r bytes (128 MiB at N=2^17); maxmem must exceed it.
  const maxmem = 128 * n * R * 2 + 1024 * 1024;
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r: R, p: P, maxmem }, (e, k) =>
      e ? reject(e) : resolve(k),
    ),
  );
}

/** Format: `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`, so parameters can be raised later. */
export async function hashPassword(password: string, logN = 17): Promise<string> {
  const n = 2 ** logN;
  const salt = randomBytes(16);
  const key = await derive(password, salt, n);
  return `scrypt$${n}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function parseScrypt(stored: string) {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !salt || !hash || r !== String(R) || p !== String(P)) return null;
  return { n: Number(n), salt: Buffer.from(salt, "base64"), hash: Buffer.from(hash, "base64") };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseScrypt(stored);
  if (!parsed) return false;
  const expected = parsed.hash;
  const actual = await derive(password, parsed.salt, parsed.n);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
