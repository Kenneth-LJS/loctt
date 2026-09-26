import { resolve } from "node:path";

import { defineConfig } from "tsup";

/**
 * The library bundle (`dist/index.js`). `@loctt/mcp` is an internal
 * workspace, not a published package (K139): the published `loctt`
 * package bundles this code from source and runs it as `loctt mcp`.
 * Core is bundled here too, like the CLI.
 */
const shared = {
  format: "esm" as const,
  target: "node20" as const,
  platform: "node" as const,
  outDir: "dist",
  // Don't clean — tsc --build already placed .d.ts files in dist
  clean: false,
  // Emit a single self-contained file per entry. Without this, esbuild
  // code-splits shared imports into ./chunk-*.js files that the package
  // `files` allowlist does not ship — so the published tarball throws
  // ERR_MODULE_NOT_FOUND on its first import. The CLI and web configs
  // already set this; the MCP config had drifted (found by the
  // publish-hardening fan-out). See known-gaps.md / decisions.md A206.
  splitting: false,
  // sharp ships a native .node binding; cannot be bundled. yaml is
  // CJS-only, proper-lockfile uses a dynamic require. ajv + ajv-formats:
  // the bundled MCP SDK generates validators that call
  // `require("ajv/dist/runtime/*")`, which breaks once inlined into ESM
  // ("Dynamic require of ajv is not supported"), exactly as the CLI's
  // tsup config records. All are declared runtime dependencies.
  external: ["yaml", "ulid", "proper-lockfile", "sharp", "ajv", "ajv-formats"],
  noExternal: ["@loctt/core", "@loctt/contracts", "@modelcontextprotocol/sdk"],
  esbuildOptions(options: { alias?: Record<string, string> }) {
    options.alias = {
      "@loctt/contracts": resolve("../../packages/contracts/src/index.ts"),
      "@loctt/core": resolve("../../packages/core/src/index.ts"),
    };
  },
};

export default defineConfig([{ ...shared, entry: ["src/index.ts"] }]);
