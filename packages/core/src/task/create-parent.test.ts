/**
 * K140 / B39: `createTask` with a `parent` produces exactly what `create`
 * followed by `link <new> <tree axis> <parent>` produces.
 *
 * The user report: "loctt create --parent GAME-4 writes the raw key into
 * the task file instead of the task ID, and doesn't add the child link on
 * the parent. doctor then reports 26 broken references, and unlink can't
 * remove them."
 *
 * @verifies REL-C6
 */
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task, WorkflowConfig } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadArchivedGuardConfigs } from "../config/archived-guard.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { checkDataIntegrity } from "../diagnostics/integrity.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { rebuildKeyIndex } from "../state/key-index.js";
import { withStateLock } from "../state/lock.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "./create.js";
import { readHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { archiveTask } from "./lifecycle.js";
import { RelationshipError, unlinkTask } from "./relationships.js";
import { validateRelationships } from "./traversal.js";

describe("createTask with a parent (K140)", () => {
  let root: string;
  let locttDir: string;
  let workflowConfig: WorkflowConfig;
  let project: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-create-parent-"));
    await initLoctt(root, { prefix: "GAME", docs: false, timezone: "UTC" });
    locttDir = resolveLocttDir(root);
    workflowConfig = await loadWorkflowConfig(locttDir);
    const state = await loadState(locttDir);
    project = Object.keys(state.keys)[0] as string;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A create exactly as the CLI and MCP run it: under the lock, state saved after. */
  async function create(title: string, parent?: string): Promise<Task> {
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);
    return withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir,
        state,
        workflowConfig,
        archivedGuard,
        options: { project, title, ...(parent !== undefined ? { parent } : {}) },
      });
      await saveState(locttDir, state);
      return task;
    });
  }

  async function nextNumber(): Promise<number> {
    const state = await loadState(locttDir);
    return state.keys[project]?.next_number ?? -1;
  }

  async function expectLinkedBothWays(child: Task, parentId: string): Promise<void> {
    const onDiskChild = await readTask(locttDir, child.frontmatter.id);
    expect(onDiskChild.frontmatter.relationships).toEqual([{ type: "parent", target: parentId, rank: "u" }]);
    const parent = await readTask(locttDir, parentId);
    expect(parent.frontmatter.relationships).toEqual([{ type: "child", target: child.frontmatter.id, rank: "u" }]);
    expect(await validateRelationships(locttDir, workflowConfig)).toEqual([]);
    expect(await checkDataIntegrity(locttDir)).toEqual([]);
  }

  it("given the parent's key, stores the parent's id and writes the child edge on the parent", async () => {
    const parent = await create("the parent");
    expect(parent.frontmatter.key).toBe("GAME-1");
    const child = await create("the child", "GAME-1");
    await expectLinkedBothWays(child, parent.frontmatter.id);

    // The parent's side gets the `link_added` entry `link` writes; the
    // child's `created` entry already records its edge (K141).
    const parentHistory = await readHistory(locttDir, parent.frontmatter.id);
    expect(parentHistory.some(h =>
      h.kind === "link_added"
      && h.meta?.["type"] === "child"
      && h.meta["target"] === child.frontmatter.id)).toBe(true);
    const childHistory = await readHistory(locttDir, child.frontmatter.id);
    expect(childHistory.map(h => h.kind)).toEqual(["created"]);
  });

  it("given the parent's id, links the same way", async () => {
    const parent = await create("the parent");
    const child = await create("the child", parent.frontmatter.id);
    await expectLinkedBothWays(child, parent.frontmatter.id);
  });

  it("given a former key (key_history), resolves to the task that held it", async () => {
    const parent = await create("the parent");
    // The parent was renamed GAME-1 → GAME-50 (a move or a reconciliation
    // does this); GAME-1 now lives in its key_history.
    const onDisk = await readTask(locttDir, parent.frontmatter.id);
    await writeTask(locttDir, parent.frontmatter.id, {
      ...onDisk,
      frontmatter: { ...onDisk.frontmatter, key: "GAME-50", key_history: ["GAME-1"] },
    });
    await rebuildKeyIndex(locttDir);

    const child = await create("the child", "GAME-1");
    await expectLinkedBothWays(child, parent.frontmatter.id);
  });

  it("unlink removes both sides of a link made by create", async () => {
    const parent = await create("the parent");
    const child = await create("the child", "GAME-1");
    await unlinkTask({
      locttDir,
      taskId: child.frontmatter.id,
      type: "parent",
      target: parent.frontmatter.id,
      workflowConfig,
    });
    expect((await readTask(locttDir, child.frontmatter.id)).frontmatter.relationships).toBeUndefined();
    expect((await readTask(locttDir, parent.frontmatter.id)).frontmatter.relationships).toBeUndefined();
  });

  it("refuses a parent that does not exist, with link's message, and writes nothing", async () => {
    await create("the parent");
    const before = await nextNumber();
    const dirsBefore = await readdir(join(locttDir, "tasks"));

    const err = await create("orphan", "NOPE-99").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelationshipError);
    // The sentence `loctt link` prints for a target that does not exist.
    expect((err as RelationshipError).message).toBe(`Task not found: "NOPE-99"`);
    // A validation failure on the `parent` field, so the web places it
    // at the field (400), not a missing page (404).
    expect((err as RelationshipError).code).toBe("validation_failed");
    expect((err as RelationshipError).field).toBe("parent");

    // No task file, and the key counter did not move: `createTask`
    // refused before writing, and the caller never saved state.
    expect(await readdir(join(locttDir, "tasks"))).toEqual(dirsBefore);
    expect(await nextNumber()).toBe(before);
  });

  it("refuses an archived parent, with link's message, and writes nothing", async () => {
    const parent = await create("the parent");
    await archiveTask(locttDir, parent.frontmatter.id);
    const before = await nextNumber();
    const dirsBefore = await readdir(join(locttDir, "tasks"));

    const err = await create("under archived", "GAME-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelationshipError);
    expect((err as RelationshipError).message).toBe("Cannot link to archived task GAME-1. Unarchive it first.");
    expect((err as RelationshipError).field).toBe("parent");

    expect(await readdir(join(locttDir, "tasks"))).toEqual(dirsBefore);
    expect(await nextNumber()).toBe(before);
    // The archived parent was not touched either.
    expect((await readTask(locttDir, parent.frontmatter.id)).frontmatter.relationships).toBeUndefined();
  });
  // The key invariant: the caller saves the counter only when createTask
  // returns, so a failure after the child is on disk used to leave a key
  // the next create issued again (A366).
  it("a parent that can't be written: the create fails, writes nothing, and the key is not issued twice", async () => {
    const parent = await create("the parent");
    const before = await nextNumber();
    const parentDir = join(locttDir, "tasks", parent.frontmatter.id);
    await chmod(parentDir, 0o555);
    try {
      await expect(create("the child", "GAME-1")).rejects.toThrow();
    } finally {
      await chmod(parentDir, 0o755);
    }
    expect(await readdir(join(locttDir, "tasks"))).toEqual([parent.frontmatter.id]);
    expect(await nextNumber()).toBe(before);
    const next = await create("another");
    expect(next.frontmatter.key).toBe(`GAME-${String(before)}`);
    expect(await checkDataIntegrity(locttDir)).toEqual([]);
  });

  it("a child that can't be written: the parent's side is taken back", async () => {
    const parent = await create("the parent");
    const before = await nextNumber();
    vi.doMock("./io.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./io.js")>();
      return {
        ...actual,
        writeTask: async (...args: Parameters<typeof actual.writeTask>) => {
          if (args[2].frontmatter.title === "the child") throw new Error("disk full");
          return actual.writeTask(...args);
        },
      };
    });
    vi.resetModules();
    try {
      const { createTask: failing } = await import("./create.js");
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      await expect(withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        const task = await failing({
          locttDir, state, workflowConfig, archivedGuard,
          options: { project, title: "the child", parent: "GAME-1" },
        });
        await saveState(locttDir, state);
        return task;
      })).rejects.toThrow("disk full");
    } finally {
      vi.doUnmock("./io.js");
      vi.resetModules();
    }
    expect(await readdir(join(locttDir, "tasks"))).toEqual([parent.frontmatter.id]);
    expect(await nextNumber()).toBe(before);
    expect((await readTask(locttDir, parent.frontmatter.id)).frontmatter.relationships ?? []).toEqual([]);
    const kinds = (await readHistory(locttDir, parent.frontmatter.id)).map(h => h.kind);
    expect(kinds.slice(-2)).toEqual(["link_added", "link_removed"]);
    expect(await validateRelationships(locttDir, workflowConfig)).toEqual([]);
  });
});
