/**
 * PBKDF2-HMAC-SHA256 on WebCrypto (`crypto.subtle`), which Node, Deno and browsers all provide.
 * Format: `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`.
 */
const KEYLEN_BITS = 256;
const SALT_BYTES = 16;

/** OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256 at 600,000 iterations. */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as never, iterations }, key, KEYLEN_BITS);
  return new Uint8Array(bits);
}

export async function hashPbkdf2(password: string, iterations = DEFAULT_PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

export function parsePbkdf2(stored: string) {
  const [alg, iter, salt, hash, extra] = stored.split("$");
  const iterations = Number(iter);
  if (alg !== "pbkdf2-sha256" || !salt || !hash || extra !== undefined || !Number.isInteger(iterations) || iterations < 1) return null;
  try {
    return { iterations, salt: unb64(salt), hash: unb64(hash) };
  } catch {
    return null;
  }
}

export async function verifyPbkdf2(password: string, stored: string): Promise<boolean> {
  const p = parsePbkdf2(stored);
  if (!p) return false;
  const actual = await derive(password, p.salt, p.iterations);
  if (actual.length !== p.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ p.hash[i]!; // constant time
  return diff === 0;
}
