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
  external: ["yaml", "ulid"],
  noExternal: ["@loctt/core", "@loctt/contracts", "@loctt/mcp", "@loctt/web", "@modelcontextprotocol/sdk"],
  esbuildOptions(options) {
    options.alias = {
      "@loctt/contracts": resolve("../../packages/contracts/src/index.ts"),
      "@loctt/core": resolve("../../packages/core/src/index.ts"),
      "@loctt/mcp": resolve("../mcp/src/index.ts"),
      "@loctt/web": resolve("../web/src/index.ts"),
    };
  },
});
