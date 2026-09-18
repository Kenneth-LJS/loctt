import { resolve } from "node:path";

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  outDir: "dist",
  // Don't clean — tsc --build already placed .d.ts files in dist
  clean: false,
  // sharp ships a native .node binding; cannot be bundled. Must be
  // installed as a runtime dep alongside the bundled output.
  external: ["yaml", "ulid", "proper-lockfile", "sharp"],
  noExternal: ["@loctt/core", "@loctt/contracts"],
  esbuildOptions(options) {
    options.alias = {
      "@loctt/contracts": resolve("../../packages/contracts/src/index.ts"),
      "@loctt/core": resolve("../../packages/core/src/index.ts"),
    };
  },
});
