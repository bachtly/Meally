import { describe, expect, it } from "vitest";
import { b64, encryptPayload, generateVapidKeys, vapidAuthorization } from "./webpush.js";

import type { webcrypto } from "node:crypto";
type CryptoKey = webcrypto.CryptoKey;
const s = globalThis.crypto.subtle;
const td = new TextDecoder();
const te = new TextEncoder();

// RFC 8291 section 5 and appendix A.
const asPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const asPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const uaPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const uaPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
const authSecret = "BTBZMqHH6r4Tts7J_aSIgg";
const salt = "DGv6ra1nlYgDCS1FRnbzlw";
const jwkOf = (pub: string, d: string) => {
  const p = b64.decode(pub);
  return { kty: "EC", crv: "P-256", x: b64.encode(p.slice(1, 33)), y: b64.encode(p.slice(33)), d };
};
const cat = (...p: Uint8Array[]) => Uint8Array.from(p.flatMap((x) => [...x]));

/** Independent decrypt (the browser's side) used to check what we send. */
async function decrypt(body: Uint8Array, uaPriv: CryptoKey, uaPub: Uint8Array, auth: Uint8Array) {
  const saltIn = body.slice(0, 16);
  const idlen = body[20]!;
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await s.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await s.deriveBits({ name: "ECDH", public: asKey }, uaPriv, 256);
  const prk = await s.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const ikm = new Uint8Array(await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: auth, info: cat(te.encode("WebPush: info\0"), uaPub, asPub) }, prk, 256));
  const k2 = await s.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const cek = await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: saltIn, info: te.encode("Content-Encoding: aes128gcm\0") }, k2, 128);
  const nonce = await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: saltIn, info: te.encode("Content-Encoding: nonce\0") }, k2, 96);
  const aes = await s.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await s.decrypt({ name: "AES-GCM", iv: nonce }, aes, cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return plain.slice(0, -1);
}

describe("encryptPayload", () => {
  it("matches the RFC 8291 example and decrypts to the RFC plaintext", async () => {
    const privateKey = await s.importKey("jwk", jwkOf(asPublic, asPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const out = await encryptPayload(te.encode("When I grow up, I want to be a watermelon"), uaPublic, authSecret, {
      ephemeral: { privateKey, publicKey: b64.decode(asPublic) },
      salt: b64.decode(salt),
    });
    const text = b64.encode(out);
    // The complete body printed in RFC 8291 section 5.
    expect(text).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
    const uaPriv = await s.importKey("jwk", jwkOf(uaPublic, uaPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    expect(td.decode(await decrypt(out, uaPriv, b64.decode(uaPublic), b64.decode(authSecret)))).toBe("When I grow up, I want to be a watermelon");
  });

  it("round-trips with fresh keys and rejects bad keys and payloads over 2 KB", async () => {
    const pair = await s.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const pub = new Uint8Array(await s.exportKey("raw", pair.publicKey));
    const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const out = await encryptPayload(te.encode('{"type":"snap"}'), b64.encode(pub), b64.encode(auth));
    expect(td.decode(await decrypt(out, pair.privateKey, pub, auth))).toBe('{"type":"snap"}');
    await expect(encryptPayload(te.encode("x"), "AAAA", b64.encode(auth))).rejects.toThrow("Invalid push keys");
    await expect(encryptPayload(new Uint8Array(2049), b64.encode(pub), b64.encode(auth))).rejects.toThrow("too large");
  });
});

describe("vapidAuthorization", () => {
  it("signs an ES256 JWT for the endpoint's origin that verifies with the public key", async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization(keys, "https://push.example.com/send/abc", "mailto:a@example.com", 1_700_000_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)!;
    expect(m[4]).toBe(keys.publicKey);
    expect(JSON.parse(td.decode(b64.decode(m[1]!)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(td.decode(b64.decode(m[2]!)))).toEqual({ aud: "https://push.example.com", exp: 1_700_000_000 + 12 * 3600, sub: "mailto:a@example.com" });
    const pub = await s.importKey("raw", b64.decode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await s.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64.decode(m[3]!), te.encode(`${m[1]}.${m[2]}`))).toBe(true);
  });
});
