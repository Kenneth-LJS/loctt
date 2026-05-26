import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { bulkArchive, bulkSetFields } from "./bulk.js";
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
    expect(t.frontmatter.assignee).toBe("u1");
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
