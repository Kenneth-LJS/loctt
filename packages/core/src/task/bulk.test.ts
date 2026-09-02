import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { bulkArchive, bulkDelete, bulkSetFields } from "./bulk.js";
import { createTask } from "./create.js";
import { readHistory } from "./history.js";
import { lookupTask } from "./lookup.js";

let root: string;
let locttDir: string;
let projectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-bulk-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const cfg = await loadProjectsConfig(locttDir);
  projectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(title: string): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const t = await createTask({ locttDir, state, options: { project: projectId, title } });
    await saveState(locttDir, state);
    return t.frontmatter.id;
  });
}

describe("bulkSetFields", () => {
  /**
   * @verifies BLK-32
   *
   * "The status change entry carries the shared `bulk_op_id`" — which
   * is what makes the activity feed able to collapse the five entries
   * as one bulk row rather than five ordinary edits.
   *
   * The case's *other* bullet, that the feed actually collapses it,
   * belongs to the activity feed itself and lands with M2.3. Without
   * the id stamped here that work would have nothing to group on, so
   * this half is the precondition rather than a partial pass.
   */
  it("applies the same change to every task and stamps a shared bulk_op_id", async () => {
    const a = await seed("A");
    const b = await seed("B");
    const c = await seed("C");
    const result = await bulkSetFields({
      locttDir, taskRefs: [a, b, c],
      changes: [{ field: "priority", value: "high" }],
    });
    expect(result.succeeded).toEqual([a, b, c]);
    expect(result.failed).toEqual([]);
    expect(result.bulk_op_id).toBeTruthy();

    for (const id of [a, b, c]) {
      const t = await lookupTask(locttDir, id);
      expect(t.frontmatter.priority).toBe("high");
      const h = await readHistory(locttDir, id);
      const bulkEntries = h.filter(e => e.bulk_op_id === result.bulk_op_id);
      expect(bulkEntries.length).toBeGreaterThan(0);
    }
  });

  it("records per-task failures without aborting the batch", async () => {
    const a = await seed("A");
    // The assignee must resolve. `bulkSetFields` delegates to
    // `setFieldsLocked`, which used to write the raw string — so this
    // fixture's `"u1"` reached disk as a reference to nobody.
    const { createUser } = await import("../users/lifecycle.js");
    await createUser(locttDir, { name: "u1" });
    const result = await bulkSetFields({
      locttDir, taskRefs: [a, "NONEXISTENT-9999"],
      changes: [{ field: "assignee", value: "u1" }],
    });
    expect(result.succeeded).toEqual([a]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.taskId).toBe("NONEXISTENT-9999");
  });

  it("accepts a task key as ref", async () => {
    const a = await seed("A");
    const ta = await lookupTask(locttDir, a);
    const result = await bulkSetFields({
      locttDir, taskRefs: [ta.frontmatter.key],
      changes: [{ field: "priority", value: "high" }],
    });
    expect(result.succeeded).toEqual([a]);
  });

  it("supports multiple changes in one bulk call", async () => {
    const a = await seed("A");
    const { createUser } = await import("../users/lifecycle.js");
    const user = await createUser(locttDir, { name: "u1" });
    const result = await bulkSetFields({
      locttDir, taskRefs: [a],
      changes: [
        { field: "priority", value: "high" },
        { field: "assignee", value: "u1" },
      ],
    });
    expect(result.succeeded).toEqual([a]);
    const t = await lookupTask(locttDir, a);
    expect(t.frontmatter.priority).toBe("high");
    // The id, not the name — bulk now resolves it like the single path.
    expect(t.frontmatter.assignee).toBe(user.id);
  });

  it("rejects empty taskRefs is OK — returns empty result", async () => {
    const result = await bulkSetFields({
      locttDir, taskRefs: [],
      changes: [{ field: "priority", value: "high" }],
    });
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("rejects immutable fields up front", async () => {
    await expect(bulkSetFields({
      locttDir, taskRefs: [],
      changes: [{ field: "id", value: "x" }],
    })).rejects.toThrow();
  });
});

describe("bulkArchive", () => {
  it("archives a batch of tasks with shared bulk_op_id", async () => {
    const a = await seed("A");
    const b = await seed("B");
    const result = await bulkArchive({ locttDir, taskRefs: [a, b], archive: true });
    expect(result.succeeded).toEqual([a, b]);
    for (const id of [a, b]) {
      const t = await lookupTask(locttDir, id);
      expect(t.frontmatter.archived).toBe(true);
      // `archived_at` too, not just the flag. bulkArchive and
      // archiveTask now share `applyArchiveState`, and this asserted
      // only `archived` — so the bulk path could have stopped writing
      // the timestamp and all 15 tests here would still have passed.
      // Found by mutation: dropping the field reddened the single-task
      // test and nothing in this file.
      expect(t.frontmatter.archived_at).toBeDefined();
      expect(t.frontmatter.updated_at).toBe(t.frontmatter.archived_at);
      const h = await readHistory(locttDir, id);
      expect(h.some(e => e.kind === "archived" && e.bulk_op_id === result.bulk_op_id)).toBe(true);
    }
  });

  it("unarchive: restores active state", async () => {
    const a = await seed("A");
    await bulkArchive({ locttDir, taskRefs: [a], archive: true });
    const result = await bulkArchive({ locttDir, taskRefs: [a], archive: false });
    expect(result.succeeded).toEqual([a]);
    const t = await lookupTask(locttDir, a);
    expect(t.frontmatter.archived).toBeUndefined();
  });

  it("idempotent: already-archived task is succeeded without a new history entry", async () => {
    const a = await seed("A");
    await bulkArchive({ locttDir, taskRefs: [a], archive: true });
    const before = (await readHistory(locttDir, a)).length;
    const result = await bulkArchive({ locttDir, taskRefs: [a], archive: true });
    expect(result.succeeded).toEqual([a]);
    const after = (await readHistory(locttDir, a)).length;
    expect(after).toBe(before);
  });
});

describe("bulkDelete", () => {
  it("removes every task directory, not just the task.md", async () => {
    const { existsSync } = await import("node:fs");
    const { getTaskDir, getHistoryFilePath } = await import("../paths/index.js");
    const a = await seed("A");
    const b = await seed("B");
    const keep = await seed("Keep");

    // Give one task a history file so we can prove the whole directory
    // goes, not only the markdown.
    expect(existsSync(getHistoryFilePath(locttDir, a))).toBe(true);

    const result = await bulkDelete({ locttDir, taskRefs: [a, b] });

    expect(result.succeeded).toEqual([a, b]);
    expect(result.failed).toEqual([]);
    expect(existsSync(getTaskDir(locttDir, a))).toBe(false);
    expect(existsSync(getTaskDir(locttDir, b))).toBe(false);
    // Unselected tasks are untouched.
    expect(existsSync(getTaskDir(locttDir, keep))).toBe(true);
  });

  it("accepts keys as well as ids", async () => {
    const { existsSync } = await import("node:fs");
    const a = await seed("A");
    const task = await lookupTask(locttDir, a);
    const { getTaskDir } = await import("../paths/index.js");

    // The UI sends whatever the row carries; a key must resolve to the
    // id whose directory is removed.
    const result = await bulkDelete({ locttDir, taskRefs: [task.frontmatter.key] });

    expect(result.succeeded).toEqual([a]);
    expect(existsSync(getTaskDir(locttDir, a))).toBe(false);
  });

  it("reports an unknown ref as failed and still deletes the rest", async () => {
    const { existsSync } = await import("node:fs");
    const a = await seed("A");
    const { getTaskDir } = await import("../paths/index.js");

    const result = await bulkDelete({ locttDir, taskRefs: [a, "T-9999"] });

    // Partial failure, not an aborted batch: BLK-38 needs each failure
    // named individually.
    expect(result.succeeded).toEqual([a]);
    expect(result.failed).toEqual([{ taskId: "T-9999", error: "task not found" }]);
    expect(existsSync(getTaskDir(locttDir, a))).toBe(false);
  });

  it("stops resolving the deleted key afterwards", async () => {
    const a = await seed("A");
    const task = await lookupTask(locttDir, a);
    await bulkDelete({ locttDir, taskRefs: [a] });

    // The key must not resolve once the directory is gone. Note this
    // does not exercise the cache clear in bulkDelete: the lookup cache
    // is negative-only, so a deletion can never leave a stale hit for
    // this to catch.
    await expect(lookupTask(locttDir, task.frontmatter.key)).rejects.toThrow();
  });
});


describe("bulkArchive reports no-ops on both directions", () => {
  // @verifies BLK-27
  it("reports an already-archived task as unchanged", async () => {
    const a = await seed("One");
    const b = await seed("Two");
    await bulkArchive({ locttDir, taskRefs: [a], archive: true });

    const result = await bulkArchive({ locttDir, taskRefs: [a, b], archive: true });
    expect(result.succeeded).toHaveLength(2);
    expect(result.unchanged).toEqual([a]);
    expect(result.failed).toEqual([]);
  });

  // @verifies BLK-27
  it("reports a never-archived task as unchanged when unarchiving", async () => {
    const a = await seed("One");
    const b = await seed("Two");
    await bulkArchive({ locttDir, taskRefs: [a], archive: true });

    // One archived, one not. The unarchive path has the same no-op case
    // as the archive path, and reporting the untouched task as restored
    // overstates what happened — the whole point of BLK-27.
    const result = await bulkArchive({ locttDir, taskRefs: [a, b], archive: false });
    expect(result.succeeded).toHaveLength(2);
    expect(result.unchanged).toEqual([b]);
  });
});
