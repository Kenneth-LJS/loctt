import { resolve } from "node:path";

import { defineConfig } from "tsup";

/**
 * Server library build for `@loctt/web` (`src/server/index.ts` →
 * `dist/server/index.js`) with `@loctt/core` and `@loctt/contracts`
 * inlined (`noExternal`). `@loctt/web` is an internal workspace, not a
 * published package (K139): the published `loctt` package bundles the
 * server from source and copies `dist/client/` (built by Vite in the same
 * `build`) beside its own bundle for `loctt ui`.
 *
 * Externalised deps mirror the CLI's, for the same reasons: `yaml` is
 * CJS-only, `busboy`/`proper-lockfile` use dynamic `require`, and `sharp`
 * ships a native binding — none can be bundled into ESM, so they stay
 * runtime deps installed alongside.
 *
 * The published `loctt` package declares them; the manifest check in
 * `tests/packaging` fails when its bundle loads a package it does not
 * declare.
 */
const shared = {
  format: "esm" as const,
  target: "node20" as const,
  platform: "node" as const,
  outDir: "dist",
  // Vite writes dist/client in the same `build`; don't wipe it.
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
  // consumed by the CLI's `loctt ui` (bundled from source there).
  // Types come from the tsc project build (see the `build` script), not
  // from tsup's dts plugin — the plugin trips on the tsconfig's `baseUrl`
  // deprecation under the TS6→7 transition. The tsc per-file .js/.test.js
  // emit alongside it is a harmless build intermediate.
  {
    ...shared,
    entry: { "server/index": "src/server/index.ts" },
  },
]);
