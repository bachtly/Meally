import type { PasswordHasher } from "../../ports/index.js";
import { hashPassword, parseScrypt, verifyPassword } from "../../features/auth/password.js";

/** scrypt with cost 2^logN; hashes made with a lower cost report `needsRehash`. */
export function createScryptHasher(logN = 17): PasswordHasher {
  return {
    hash: (password) => hashPassword(password, logN),
    async verify(password, stored) {
      const ok = await verifyPassword(password, stored);
      const p = parseScrypt(stored);
      return { ok, needsRehash: ok && (!p || p.n < 2 ** logN) };
    },
  };
}
