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
  // Emit a single self-contained index.js. Without this, esbuild
  // code-splits shared imports into ./chunk-*.js files that the package
  // `files` allowlist does not ship — so the published tarball throws
  // ERR_MODULE_NOT_FOUND on its first import. The CLI and web configs
  // already set this; the MCP config had drifted (found by the
  // publish-hardening fan-out). See known-gaps.md / decisions.md A206.
  splitting: false,
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
