import type { PasswordHasher } from "../../ports/index.js";
import { createHasher } from "../hasher.js";

/** scrypt with cost 2^logN is preferred; pbkdf2 hashes (made on the edge) still verify and report `needsRehash`. */
export function createScryptHasher(logN = 17): PasswordHasher {
  return createHasher({ kind: "scrypt", logN });
}
