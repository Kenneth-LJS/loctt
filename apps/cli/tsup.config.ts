import { cp, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { defineConfig } from "tsup";

/**
 * `loctt ui` serves the web client, and the client ships inside this
 * package, the one published package `loctt` (A352, K139). It bundles
 * the internal `@loctt/web` workspace's server code and the internal
 * `@loctt/mcp` workspace from source, so it carries the client beside
 * them: one install, one version, no second package to find on disk.
 *
 * Runs after every build (including `tsup --watch`, whose `clean` would
 * otherwise wipe the copy). The web client must already be built; the
 * root `npm run build` builds `apps/web` first for this reason. A build
 * without it fails here, loudly, instead of producing a CLI whose `ui`
 * command has nothing to serve (the RR-B4 defect).
 */
async function copyWebClient(): Promise<void> {
  const from = resolve("../web/dist/client");
  const to = resolve("dist/client");
  const found = await stat(resolve(from, "index.html")).then(() => true, () => false);
  if (!found) {
    throw new Error(
      `loctt build: the web client is not built (${from}/index.html is missing). ` +
      `Run \`npm run build\` from the repository root, which builds apps/web first.`,
    );
  }
  await cp(from, to, { recursive: true });
}

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
  // ajv (pulled in by the bundled MCP SDK for tool-schema validation)
  // generates validators containing CommonJS require("ajv/dist/runtime/*")
  // calls. Inlined into ESM output those become "Dynamic require of ajv
  // is not supported" at runtime the moment `loctt mcp` compiles a schema.
  // Keep ajv + ajv-formats external so they load as normal Node modules;
  // both are declared runtime deps of the CLI. (Found by the
  // publish-hardening fan-out — end-to-end, not from the bundle grep alone.)
  external: ["yaml", "ulid", "busboy", "proper-lockfile", "sharp", "ajv", "ajv-formats"],
  onSuccess: copyWebClient,
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
