import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node24",
  clean: true,
  // shared is consumed from TS source, so bundle it; npm deps stay external.
  noExternal: ["@meally/shared"],
  onSuccess: async () => {
    cpSync("src/db/migrations", "dist/migrations", { recursive: true });
  },
});
