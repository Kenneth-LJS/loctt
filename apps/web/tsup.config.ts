import { resolve } from "node:path";

import { defineConfig } from "tsup";

/**
 * Server build for `@loctt/web` (K89 / B4). Bundles the HTTP server
 * (`main.ts` → `dist/server/index.js`) with `@loctt/core` and
 * `@loctt/contracts` inlined (`noExternal`), the same way the CLI and MCP
 * bundle core — so the published package needs no separate `@loctt/core`
 * install. The client is built separately by Vite into `dist/client/`,
 * which the bin serves as a sibling of this bundle.
 *
 * Externalised deps mirror the CLI's, for the same reasons: `yaml` is
 * CJS-only, `busboy`/`proper-lockfile` use dynamic `require`, and `sharp`
 * ships a native binding — none can be bundled into ESM, so they stay
 * runtime deps installed alongside.
 */
const shared = {
  format: "esm" as const,
  target: "node20" as const,
  platform: "node" as const,
  outDir: "dist",
  // Vite writes dist/client in the same `build`; don't wipe it, and the
  // two tsup entries below share the dir too.
  clean: false,
  splitting: false,
  external: ["yaml", "ulid", "busboy", "proper-lockfile", "sharp"],
  noExternal: ["@loctt/core", "@loctt/contracts"],
  esbuildOptions(options: { alias?: Record<string, string> }) {
    options.alias = {
      "@loctt/contracts": resolve("../../packages/contracts/src/index.ts"),
      "@loctt/core": resolve("../../packages/core/src/index.ts"),
    };
  },
};

export default defineConfig([
  // The library entry (`@loctt/web` `main`): exports `createWebApp` etc.,
  // consumed by `@loctt/cli`'s `loctt ui`. Types emitted so importers
  // type-check against the published package.
  // Types come from the tsc project build (see the `build` script), not
  // from tsup's dts plugin — the plugin trips on the tsconfig's `baseUrl`
  // deprecation under the TS6→7 transition. `files` in package.json ships
  // only dist/server/index.d.ts, so the tsc per-file .js/.test.js emit
  // alongside it is a harmless build intermediate.
  {
    ...shared,
    entry: { "server/index": "src/server/index.ts" },
  },
  // The bin (`loctt-ui`): the standalone launcher (main.ts starts the
  // server, serves the bundled client, opens the browser). A separate
  // artifact with the node shebang; no types needed.
  {
    ...shared,
    entry: { "server/cli": "src/server/main.ts" },
    banner: { js: "#!/usr/bin/env node" },
  },
]);
