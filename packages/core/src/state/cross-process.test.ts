import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { createProject } from "../projects/manage.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import { loadJournal } from "./journal.js";
import { withStateLock } from "./lock.js";
import { loadState, saveState } from "./state.js";

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

/**
 * Phase 10: cross-process crash recovery.
 *
 * The in-process journal.test.ts cases stage on-disk crash state by
 * hand and call `withStateLock` from the same process. That tests
 * the recovery logic but doesn't prove cross-process recovery
 * actually works: a journal entry written by process A must be
 * picked up by process B's withStateLock recovery hook.
 *
 * Two scenarios:
 *
 *   1. Clean release, pending journal. Worker A writes a
 *      `remap_project` entry and rewrites half the affected tasks,
 *      then exits — releasing the lock cleanly but leaving the
 *      journal entry and the task remap incomplete. Worker B
 *      acquires the lock, recovery fires, completes the remap.
 *
 *   2. SIGKILL with held lock (true stale lock). Worker A writes
 *      the entry, rewrites half the tasks, then `process.exit(0)`
 *      WITHOUT releasing the lock (we hack the lockfile mtime to
 *      simulate a 10s+ stale window without waiting). Worker B
 *      acquires the lock by breaking the stale one, recovery
 *      fires, completes the remap.
 */

/**
 * Victim worker: opens the state lock, writes a `remap_project`
 * journal entry, rewrites half the listed task_ids, then EITHER
 * cleanly exits (which releases the lock) OR exits without
 * releasing (mode=hold).
 *
 * Args: [locttDir, mode, fromProject, toProject, ...taskIds]
 *   mode = "release" | "hold"
 */
function victimWorkerSource(coreEntry: string): string {
  return `
import {
  appendJournalEntry,
  getStateFilePath,
  loadJournal,
  readTask,
  saveJournal,
  withStateLock,
  writeTask,
} from ${JSON.stringify(coreEntry)};
import { mkdir } from "node:fs/promises";

const [locttDir, mode, fromProject, toProject, ...taskIds] = process.argv.slice(2);
if (!locttDir || !mode || !fromProject || !toProject || taskIds.length === 0) {
  console.error("usage: victim <locttDir> <mode> <from> <to> <taskIds...>");
  process.exit(2);
}

async function rewriteHalf(ids) {
  // Rewrite first half of the tasks to simulate a crash point
  // mid-loop. The remaining tasks will be picked up by recovery.
  const halfCount = Math.floor(ids.length / 2);
  for (let i = 0; i < halfCount; i += 1) {
    const t = await readTask(locttDir, ids[i]);
    await writeTask(locttDir, ids[i], {
      ...t,
      frontmatter: { ...t.frontmatter, project: toProject },
    });
  }
}

try {
  if (mode === "release") {
    // Clean release: do the journal write + half the rewrites
    // INSIDE withStateLock, then return normally — the lock is
    // released by withStateLock's finally clause, but the journal
    // entry remains because we never cleared it.
    await withStateLock(locttDir, async () => {
      const journal = await loadJournal(locttDir);
      const next = appendJournalEntry(journal, {
        id: "01XPTEST_VICTIM",
        kind: "remap_project",
        started_at: new Date().toISOString(),
        from: fromProject, to: toProject,
        task_ids: taskIds,
      });
      await saveJournal(locttDir, next);
      await rewriteHalf(taskIds);
    });
    process.stdout.write("victim:released\\n");
    process.exit(0);
  } else if (mode === "hold") {
    // Hold mode: write the journal entry and rewrite half the
    // tasks WITHOUT taking the state lock (we're the only process
    // touching this fresh tracker, so it's safe). Then hand-create
    // the lockdir to mimic having held it, and SIGKILL ourselves —
    // bypasses normal exit handlers so proper-lockfile doesn't
    // remove the lockdir.
    const journal = await loadJournal(locttDir);
    const next = appendJournalEntry(journal, {
      id: "01XPTEST_VICTIM_HOLD",
      kind: "remap_project",
      started_at: new Date().toISOString(),
      from: fromProject, to: toProject,
      task_ids: taskIds,
    });
    await saveJournal(locttDir, next);
    await rewriteHalf(taskIds);

    await mkdir(getStateFilePath(locttDir) + ".lock").catch(() => {});

    process.stdout.write("victim:holding\\n");
    process.kill(process.pid, "SIGKILL");
  }
} catch (err) {
  console.error("victim error:", err && err.message ? err.message : String(err));
  process.exit(1);
}
`;
}

/**
 * Recoverer worker: invokes withStateLock with a no-op body, which
 * fires the recovery hook on any pending journal entries. Prints
 * "ok" on success.
 */
function recovererWorkerSource(coreEntry: string): string {
  return `
import { withStateLock } from ${JSON.stringify(coreEntry)};
const locttDir = process.argv[2];
if (!locttDir) { console.error("missing locttDir"); process.exit(2); }
try {
  await withStateLock(locttDir, async () => {});
  process.stdout.write("ok\\n");
  process.exit(0);
} catch (err) {
  console.error("recoverer error:", err && err.message ? err.message : String(err));
  process.exit(1);
}
`;
}

describe.skipIf(SKIP_REASON !== "")("cross-process crash recovery", () => {
  let root: string;
  let locttDir: string;
  let victimPath: string;
  let recovererPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-xp-recovery-"));
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
    victimPath = join(root, "victim.mjs");
    recovererPath = join(root, "recoverer.mjs");
    await writeFile(victimPath, victimWorkerSource(coreDistIndex), "utf-8");
    await writeFile(recovererPath, recovererWorkerSource(coreDistIndex), "utf-8");

    // Seed: create the destination project + four tasks under the
    // default `task` project.
    await createProject(locttDir, { key: "p2", label: "Two", prefix: "P-" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      for (let i = 0; i < 4; i += 1) {
        await createTask({
          locttDir, state,
          options: { project: "task", title: "task " + i },
        });
      }
      await saveState(locttDir, state);
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function listTaskIds(): Promise<string[]> {
    const tasks = await loadAllTasks(locttDir);
    return tasks.map(t => t.frontmatter.id);
  }

  it("clean release: process B picks up a pending journal entry from process A", async () => {
    const ids = await listTaskIds();
    expect(ids).toHaveLength(4);

    // Worker A: write journal entry, rewrite half the tasks, exit
    // cleanly (releases the lock but leaves the entry).
    const aOut = await new Promise<string>((resolveP, rejectP) => {
      const child = spawn(process.execPath, [
        victimPath, locttDir, "release", "task", "p2", ...ids,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; let err = "";
      child.stdout.on("data", c => { out += String(c); });
      child.stderr.on("data", c => { err += String(c); });
      child.on("close", code => {
        if (code === 0) resolveP(out.trim());
        else rejectP(new Error(`victim exit ${code}: ${err}`));
      });
    });
    expect(aOut).toBe("victim:released");

    // Mid-state sanity: journal has the pending entry, half tasks
    // are remapped, half still on the old project.
    const midJournal = await loadJournal(locttDir);
    expect(midJournal.entries).toHaveLength(1);
    const midTasks = await loadAllTasks(locttDir);
    const onP2 = midTasks.filter(t => t.frontmatter.project === "p2");
    const onTask = midTasks.filter(t => t.frontmatter.project === "task");
    expect(onP2.length + onTask.length).toBe(4);
    expect(onP2).toHaveLength(2);
    expect(onTask).toHaveLength(2);

    // Worker B: no-op withStateLock — recovery hook completes the
    // remap and clears the entry.
    const bOut = await new Promise<string>((resolveP, rejectP) => {
      const child = spawn(process.execPath, [recovererPath, locttDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = ""; let err = "";
      child.stdout.on("data", c => { out += String(c); });
      child.stderr.on("data", c => { err += String(c); });
      child.on("close", code => {
        if (code === 0) resolveP(out.trim());
        else rejectP(new Error(`recoverer exit ${code}: ${err}`));
      });
    });
    // bOut may have a leading audit line ("[loctt] journal recovery
    // replayed entry ..." from console.info) — we only care that the
    // recoverer reached the "ok" success print at the end.
    expect(bOut.split("\n").pop()).toBe("ok");

    // Post-state: all tasks remapped, journal cleared, source
    // project removed from projects.yaml.
    const finalJournal = await loadJournal(locttDir);
    expect(finalJournal.entries).toHaveLength(0);
    const finalTasks = await loadAllTasks(locttDir);
    expect(finalTasks.every(t => t.frontmatter.project === "p2")).toBe(true);
    const projects = await loadProjectsConfig(locttDir);
    expect(projects.projects.some(p => p.key === "task")).toBe(false);
  }, 30_000);

  it("SIGKILL'd holder: process B breaks the stale lock and completes recovery", async () => {
    // True stale-lock case: worker A writes the journal entry,
    // rewrites half the tasks, hand-creates the state lockdir to
    // mimic having held it, then SIGKILLs itself.
    //
    // The 10s stale-lock window would normally force the recoverer
    // to wait that long. We sidestep that by backdating the
    // lockdir's mtime (utimes call below) so proper-lockfile's
    // mtime-vs-stale comparison treats it as already-expired. Same
    // trick the in-process stale-lock test uses; this is the
    // cross-process variant.
    const ids = await listTaskIds();
    expect(ids).toHaveLength(4);

    const aOut = await new Promise<string>((resolveP, rejectP) => {
      const child = spawn(process.execPath, [
        victimPath, locttDir, "hold", "task", "p2", ...ids,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; let err = "";
      child.stdout.on("data", c => { out += String(c); });
      child.stderr.on("data", c => { err += String(c); });
      child.on("close", code => {
        // SIGKILL exits with code null + signal "SIGKILL"; treat
        // as success when we got the "holding" output line.
        if (out.includes("victim:holding")) resolveP(out.trim());
        else rejectP(new Error(`victim exit ${code}: ${err}`));
      });
    });
    expect(aOut).toContain("victim:holding");

    // The lockdir is present (mtime ~ now). Manually backdate it
    // past the 10s stale window so worker B can break it without
    // the test sleeping 10 seconds. This is the same trick the
    // in-process stale-lock test uses, just applied through the
    // file system rather than within the same process.
    const { utimes } = await import("node:fs/promises");
    const { getStateFilePath } = await import("../paths/index.js");
    const lockDir = getStateFilePath(locttDir) + ".lock";
    const oldTime = new Date(Date.now() - 60_000);
    await utimes(lockDir, oldTime, oldTime);

    const bOut = await new Promise<string>((resolveP, rejectP) => {
      const child = spawn(process.execPath, [recovererPath, locttDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = ""; let err = "";
      child.stdout.on("data", c => { out += String(c); });
      child.stderr.on("data", c => { err += String(c); });
      child.on("close", code => {
        if (code === 0) resolveP(out.trim());
        else rejectP(new Error(`recoverer exit ${code}: ${err}`));
      });
    });
    // bOut may have a leading audit line ("[loctt] journal recovery
    // replayed entry ..." from console.info) — we only care that the
    // recoverer reached the "ok" success print at the end.
    expect(bOut.split("\n").pop()).toBe("ok");

    const finalJournal = await loadJournal(locttDir);
    expect(finalJournal.entries).toHaveLength(0);
    const finalTasks = await loadAllTasks(locttDir);
    expect(finalTasks.every(t => t.frontmatter.project === "p2")).toBe(true);
  }, 30_000);
});
