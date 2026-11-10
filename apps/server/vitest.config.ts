import { defineConfig } from "vitest/config";

export default defineConfig({
  // Embedded PGlite starts a WASM Postgres per test file; give slow CI machines room.
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
