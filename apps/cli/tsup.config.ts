import { resolve } from "node:path";

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
  // Bundle workspace packages and MCP SDK; keep yaml/ulid as runtime deps
  // (yaml is CJS-only for Node and can't be bundled into ESM)
  // busboy is CJS-only and uses dynamic require("stream"); tsup's ESM
  // output can't shim that. Keep it external so the CLI loads it as a
  // normal Node module at runtime.
  // proper-lockfile is CJS and uses dynamic require for graceful-fs;
  // bundling into ESM breaks at runtime. Keep external.
  // sharp ships a native .node binding loaded via dynamic require;
  // can't be bundled. Must be installed as a runtime dep on the
  // host that runs the CLI.
  external: ["yaml", "ulid", "busboy", "proper-lockfile", "sharp"],
  noExternal: ["@loctt/core", "@loctt/contracts", "@loctt/mcp", "@loctt/web", "@modelcontextprotocol/sdk"],
  esbuildOptions(options) {
    options.alias = {
      "@loctt/contracts": resolve("../../packages/contracts/src/index.ts"),
      "@loctt/core": resolve("../../packages/core/src/index.ts"),
      "@loctt/mcp": resolve("../mcp/src/index.ts"),
      "@loctt/web": resolve("../web/src/server/index.ts"),
    };
  },
});
