import type { PasswordHasher } from "../ports/index.js";
import { hashPassword, parseScrypt, verifyPassword } from "../features/auth/password.js";
import { hashPbkdf2, parsePbkdf2, verifyPbkdf2 } from "../features/auth/pbkdf2.js";

export type HashScheme = { kind: "scrypt"; logN: number } | { kind: "pbkdf2"; iterations: number };

/**
 * Hashes with the platform's preferred scheme; verifies both formats. A hash in the other format, or at a
 * lower cost than preferred, reports `needsRehash` so login can upgrade it.
 */
export function createHasher(prefer: HashScheme): PasswordHasher {
  return {
    hash: (password) => (prefer.kind === "scrypt" ? hashPassword(password, prefer.logN) : hashPbkdf2(password, prefer.iterations)),
    async verify(password, stored) {
      const scrypt = parseScrypt(stored);
      const pbkdf2 = scrypt ? null : parsePbkdf2(stored);
      if (!scrypt && !pbkdf2) return { ok: false, needsRehash: false };
      const ok = scrypt ? await verifyPassword(password, stored) : await verifyPbkdf2(password, stored);
      const current =
        prefer.kind === "scrypt" ? !!scrypt && scrypt.n >= 2 ** prefer.logN : !!pbkdf2 && pbkdf2.iterations >= prefer.iterations;
      return { ok, needsRehash: ok && !current };
    },
  };
}
