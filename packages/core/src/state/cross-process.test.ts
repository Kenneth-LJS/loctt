import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadAllTasks } from "../task/load-all.js";

/**
 * Cross-process concurrency tests. Verifies that proper-lockfile's
 * OS-level lock actually serializes mutations from independent Node
 * processes — not just from concurrent async contexts within a single
 * process. This is the integration scenario the lock was built for
 * (CLI + MCP + web all racing the same `.loctt/`); single-process
 * tests in lock.test.ts and journal.test.ts cover the in-process
 * behavior, this file covers the cross-process behavior.
 *
 * Requires the core package to be built (dist/index.js). Skipped
 * gracefully when it isn't, since the worker is a plain Node script
 * loaded via absolute path — we don't have a TS loader in the child.
 */

const here = dirname(fileURLToPath(import.meta.url));
const coreDistIndex = resolve(here, "..", "..", "dist", "index.js");

/**
 * Worker source: imports the built @loctt/core via absolute path,
 * runs `createTask` inside a single `withStateLock`, prints the
 * resulting task key to stdout. The parent test spawns N copies
 * concurrently and verifies all complete with distinct keys.
 *
 * Single CLI arg: the absolute `.loctt/` path.
 */
function workerSource(coreEntry: string): string {
  return `
import { withStateLock, loadState, saveState, createTask } from ${JSON.stringify(coreEntry)};

const locttDir = process.argv[2];
if (!locttDir) {
  console.error("missing locttDir arg");
  process.exit(2);
}

try {
  const task = await withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const created = await createTask({
      locttDir,
      state,
      options: { project: "task", title: "from worker " + process.pid },
    });
    await saveState(locttDir, state);
    return created;
  });
  process.stdout.write(task.frontmatter.key + "\\n");
  process.exit(0);
} catch (err) {
  console.error("worker error:", err && err.message ? err.message : String(err));
  process.exit(1);
}
`;
}

async function spawnWorker(scriptPath: string, locttDir: string): Promise<string> {
  return await new Promise<string>((resolveP, rejectP) => {
    const child = spawn(process.execPath, [scriptPath, locttDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", rejectP);
    child.on("close", code => {
      if (code === 0) resolveP(stdout.trim());
      else rejectP(new Error(`worker exited ${code}: ${stderr.trim()}`));
    });
  });
}

const SKIP_REASON = !existsSync(coreDistIndex)
  ? "skipped: @loctt/core dist not built (run `npm run build` to enable)"
  : "";

describe.skipIf(SKIP_REASON !== "")("cross-process lock serialization", () => {
  let root: string;
  let locttDir: string;
  let scriptPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-xp-"));
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
    scriptPath = join(root, "worker.mjs");
    await writeFile(scriptPath, workerSource(coreDistIndex), "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("five concurrent createTask workers all succeed with distinct keys", async () => {
    // The OS-level lock must serialize these five processes. If any
    // pair raced the state read/write, two tasks would receive the
    // same key (T-N) and we'd see fewer than 5 distinct keys, or one
    // worker would fail with a constraint error.
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, () => spawnWorker(scriptPath, locttDir)),
    );
    expect(results).toHaveLength(N);
    expect(new Set(results).size).toBe(N);
    // Keys are sequentially allocated within the `task` project's
    // counter; we don't enforce order (any ordering of T-1..T-N is
    // fine), only that all 5 land on disk.
    expect(results.every(k => /^T-[1-5]$/.test(k))).toBe(true);

    // Final on-disk state: 5 tasks visible, no corruption.
    const tasks = await loadAllTasks(locttDir);
    expect(tasks).toHaveLength(N);
    const titles = tasks.map(t => t.frontmatter.title);
    expect(new Set(titles).size).toBe(N);
  }, 30_000);

  it("a sequential pair of workers each see the other's prior write", async () => {
    // Sanity check that the lock isn't trivially passing the
    // concurrent test by accident. Run two workers strictly in
    // sequence; the second must observe state.yaml has been bumped
    // (key T-2, not T-1).
    const first = await spawnWorker(scriptPath, locttDir);
    const second = await spawnWorker(scriptPath, locttDir);
    expect(first).toBe("T-1");
    expect(second).toBe("T-2");
  }, 20_000);
});
