/**
 * Web Push with WebCrypto only (no Node APIs), so it runs on Node and Deno alike.
 * Message encryption is RFC 8291 over RFC 8188 `aes128gcm`; sender identity is a VAPID JWT (RFC 8292, ES256).
 */
import type { webcrypto } from "node:crypto";

type CryptoKey = webcrypto.CryptoKey;
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export const b64 = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array {
    const s = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
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
/** WebCrypto's types want an ArrayBuffer-backed view. */
const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

/** Safari's payload limit is the tightest in practice; push services must accept at least 4096 bytes (RFC 8030). */
export const MAX_PAYLOAD_BYTES = 2048;
const RECORD_SIZE = 4096;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, bytes * 8));
}

export interface EncryptOptions {
  /** Fixed sender key and salt, for the RFC test vector only. */
  ephemeral?: { privateKey: CryptoKey; publicKey: Uint8Array };
  salt?: Uint8Array;
}

/** Encrypts `plaintext` for one browser subscription (`p256dh` and `auth` as the browser gave them, base64url). */
export async function encryptPayload(plaintext: Uint8Array, p256dh: string, auth: string, opts: EncryptOptions = {}): Promise<Uint8Array> {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error("Push payload is too large");
  const uaPublic = b64.decode(p256dh);
  const authSecret = b64.decode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error("Invalid push keys");
  let eph = opts.ephemeral;
  if (!eph) {
    const pair = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    eph = { privateKey: pair.privateKey, publicKey: new Uint8Array(await subtle().exportKey("raw", pair.publicKey)) };
  }
  const uaKey = await subtle().importKey("raw", buf(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, eph.publicKey), 32);
  const salt = opts.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await subtle().importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  // One record: the data, then the 0x02 "last record" delimiter.
  const record = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: buf(nonce) }, aes, buf(concat(plaintext, Uint8Array.of(2)))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = eph.publicKey.length;
  return concat(header, eph.publicKey, record);
}

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url (what the browser's `applicationServerKey` takes). */
  publicKey: string;
  /** Raw 32-byte private scalar, base64url. */
  privateKey: string;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  const pub = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return { publicKey: b64.encode(pub), privateKey: jwk.d! };
}

/** Imports a VAPID pair for signing; throws when it is not a well-formed P-256 key. */
export async function importVapidPrivate(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64.decode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
  return subtle().importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64.encode(pub.slice(1, 33)), y: b64.encode(pub.slice(33)), d: keys.privateKey },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** The `Authorization` header for a push service: `vapid t=<JWT>, k=<public key>`. */
export async function vapidAuthorization(keys: VapidKeys, endpoint: string, subject: string, nowMs: number): Promise<string> {
  const key = await importVapidPrivate(keys);
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject };
  const head = b64.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64.encode(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, buf(enc.encode(`${head}.${body}`))));
  return `vapid t=${head}.${body}.${b64.encode(sig)}, k=${keys.publicKey}`;
}
