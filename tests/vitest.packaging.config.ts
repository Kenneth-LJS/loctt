import { defineConfig } from "vitest/config";

/**
 * The packaging suite (RR-B1, RR-B4; A352): packs each published
 * package, installs it outside the repo with only its declared
 * dependencies, and runs it. Slow and build-dependent, so it is its own
 * script (`npm run test:packaging`, which builds first) rather than part
 * of `npm run test`.
 *
 * One worker: the files share nothing, but each spawns servers and packs
 * 2-5 MB tarballs, and running them side by side only adds contention.
 */
export default defineConfig({
  test: {
    name: "packaging",
    include: ["tests/packaging/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    maxWorkers: 1,
  },
});
