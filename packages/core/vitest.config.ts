import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * Per-test timeout. Vitest's stock 5s default is fine for the
     * in-memory tests but flakes on the subprocess-heavy ones
     * (anything that shells out to `git` or `npm` repeatedly) when
     * the runner is under CPU pressure from sibling files. 20s
     * gives them headroom without letting an actually-broken test
     * hang CI forever.
     *
     * The flakes this prevents:
     *   - src/git/publish-sync.test.ts — multiple execSync git calls per test
     *   - src/git/push-fetch.test.ts   — same; some tests do real push to a bare remote
     *   - src/scaffold.test.ts         — runs `npm ls --json` and `npx tsc --build --dry`
     *
     * They all pass cleanly in isolation; the bump only matters
     * under the parallel `npm test` workload.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
    /**
     * Match the root vitest config's exclude list — without this
     * the per-workspace config picks up the compiled `dist/*.test.js`
     * files alongside the `src/*.test.ts` sources and runs every
     * test twice (with the compiled copy potentially stale across
     * schema changes).
     */
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
