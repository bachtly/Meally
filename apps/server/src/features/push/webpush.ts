/**
 * Web Push without a library: payload encryption (RFC 8291, `aes128gcm` from RFC 8188) and VAPID signing
 * (RFC 8292). Only Web Crypto is used, so the same code runs on Node and on the edge (Deno).
 */

import type { webcrypto } from "node:crypto";

type CryptoKeyPair = webcrypto.CryptoKeyPair;
type JsonWebKey = webcrypto.JsonWebKey;
type BufferSource = webcrypto.BufferSource;

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** The application server's key pair, as browsers want it: the raw 65-byte public point and the 32-byte `d`, base64url. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` contact for the push service (RFC 8292 section 2.1). */
  subject: string;
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = (await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey("raw", kp.publicKey));
  const jwk = await subtle().exportKey("jwk", kp.privateKey);
  return { publicKey: b64url(raw), privateKey: jwk.d! };
}

/** True when the pair is a usable P-256 key (for env-supplied keys). */
export async function validVapidKeys(k: { publicKey: string; privateKey: string }): Promise<boolean> {
  try {
    await signingKey(k);
    return fromB64url(k.publicKey).length === 65 && fromB64url(k.privateKey).length === 32;
  } catch {
    return false;
  }
}

function signingKey(k: { publicKey: string; privateKey: string }) {
  const pub = fromB64url(k.publicKey);
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: k.privateKey, ext: false };
  return subtle().importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/**
 * `Authorization: vapid t=<JWT>, k=<public key>` for one push service origin. The JWT is ES256 over
 * `{ aud, exp, sub }`; Web Crypto already returns the raw r||s signature JWS wants.
 */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowMs = Date.now()): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // At most 24 h ahead (RFC 8292); 12 h leaves room for clock skew.
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: keys.subject })));
  const sig = new Uint8Array(await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(keys), enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}

/** One record is enough: payloads are at most 2 KB. */
const RECORD_SIZE = 4096;

/**
 * Encrypts `plaintext` for one subscription (RFC 8291). Returns the whole request body: the `aes128gcm` header
 * (salt, record size, our ephemeral public key) followed by the single encrypted record.
 * `salt` and `serverKeys` are for tests; real calls leave them out so both are fresh per message.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  sub: { p256dh: string; auth: string },
  test?: { salt: Uint8Array; serverKeys: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const server = test?.serverKeys ?? ((await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const serverPublic = new Uint8Array(await subtle().exportKey("raw", server.publicKey));
  const uaKey = await subtle().importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, serverPublic), 32);
  const salt = test?.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 marks the last (only) record; no padding.
  const record = concat(plaintext, new Uint8Array([2]));
  if (record.length + 16 > RECORD_SIZE) throw new Error("Push payload too large");
  const aes = await subtle().importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 }, aes, record as BufferSource));

  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, RECORD_SIZE);
  head[20] = serverPublic.length;
  return concat(head, serverPublic, sealed);
}
