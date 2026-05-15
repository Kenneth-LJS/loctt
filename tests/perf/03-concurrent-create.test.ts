import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { loadState } from "@loctt/core";
import { beforeAll,describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withTmpLoctt } from "../integration/fixtures/tmp-loctt.js";

const PARALLELISM = 10;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_DIST = path.join(REPO_ROOT, "apps/cli/dist/index.js");
const CLI_SRC = path.join(REPO_ROOT, "apps/cli/src/index.ts");

/**
 * The perf suite skips the `pretest` rebuild hook on purpose (it's
 * slow and the other perf tests don't need a fresh dist). This test
 * does spawn the bundled CLI, so a stale build would make the
 * regression silently invisible. Compare mtimes and fail loud if
 * dist is older than src — the operator's path forward is `npm run
 * build` before re-running.
 */
async function assertCliBuildIsFresh(): Promise<void> {
  let distStat;
  try {
    distStat = await stat(CLI_DIST);
  } catch {
    throw new Error(
      `apps/cli/dist/index.js is missing — run \`npm run build\` before \`npm run test:perf\`.`,
    );
  }
  const srcStat = await stat(CLI_SRC);
  if (distStat.mtimeMs < srcStat.mtimeMs) {
    throw new Error(
      `apps/cli/dist is older than apps/cli/src — run \`npm run build\` before \`npm run test:perf\`. ` +
      `(dist mtime ${new Date(distStat.mtimeMs).toISOString()}, src mtime ${new Date(srcStat.mtimeMs).toISOString()})`,
    );
  }
}

describe("perf: 10 parallel CLI create processes", () => {
  beforeAll(assertCliBuildIsFresh);

  it("allocates unique sequential keys with no state.yaml corruption", async () => {
    await withTmpLoctt(async ({ root }) => {
      const t0 = performance.now();
      const results = await Promise.all(
        Array.from({ length: PARALLELISM }, (_, i) =>
          runCli(["create", `task-${i}`], { cwd: root, timeout: 30_000 }),
        ),
      );
      const elapsedMs = performance.now() - t0;

      const failures = results.filter(r => r.exitCode !== 0);
      if (failures.length > 0) {
        for (const f of failures) {
          console.error(`failed CLI: exit=${f.exitCode}\nstderr=${f.stderr}\nstdout=${f.stdout}`);
        }
      }
      expect(failures).toEqual([]);

      const locttDir = path.join(root, ".loctt");
      const taskDirs = await readdir(path.join(locttDir, "tasks"));
      expect(taskDirs.length).toBe(PARALLELISM);

      // Collect every key from every task.md frontmatter
      const keys: string[] = [];
      for (const dir of taskDirs) {
        const text = await readFile(path.join(locttDir, "tasks", dir, "task.md"), "utf8");
        const m = text.match(/^key:\s*(\S+)/m);
        if (!m) throw new Error(`no key in task.md for ${dir}`);
        keys.push(m[1]);
      }

      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(PARALLELISM);

      // state.yaml must parse cleanly and reflect that at least PARALLELISM+1
      // numbers have been consumed.
      const state = await loadState(locttDir);
      const taskKeyState = state.keys["task"];
      expect(taskKeyState).toBeDefined();
      expect(taskKeyState!.next_number).toBeGreaterThanOrEqual(PARALLELISM + 1);

      // Keys should be exactly T-1..T-PARALLELISM in some order.
      const numbers = keys
        .map(k => Number(k.replace(/^[^0-9]*/, "")))
        .sort((a, b) => a - b);
      const expected = Array.from({ length: PARALLELISM }, (_, i) => i + 1);
      expect(numbers).toEqual(expected);

      console.log(
        `concurrent-create: ${results.length}/${PARALLELISM} succeeded in ` +
          `${(elapsedMs / 1000).toFixed(2)}s; keys=[${[...keys].sort().join(", ")}]; ` +
          `next_number=${taskKeyState!.next_number}`,
      );
    });
  }, 60_000);
});
