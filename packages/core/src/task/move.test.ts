import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { getTaskFilePath, resolveLocttDir } from "../paths/index.js";
import { archiveProject, createProject } from "../projects/manage.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "./create.js";
import { readHistory } from "./history.js";
import { lookupTask } from "./lookup.js";
import { bulkMoveTasksToProject, MoveTaskError,moveTaskToProject } from "./move.js";

let root: string;
let locttDir: string;
let projectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-move-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const cfg = await loadProjectsConfig(locttDir);
  projectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(title: string, project = projectId): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const t = await createTask({ locttDir, state, options: { project, title } });
    await saveState(locttDir, state);
    return t.frontmatter.id;
  });
}

describe("moveTaskToProject", () => {
  it("changes project, allocates a new key, and appends to key_history", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    const id = await seed("A");
    const before = await lookupTask(locttDir, id);
    const result = await moveTaskToProject({ locttDir, taskRef: id, targetProjectId: alt.id });
    expect(result.newKey.startsWith("ALT-")).toBe(true);
    expect(result.oldKey).toBe(before.frontmatter.key);
    const after = await lookupTask(locttDir, id);
    expect(after.frontmatter.project).toBe(alt.id);
    expect(after.frontmatter.key).toBe(result.newKey);
    expect(after.frontmatter.key_history).toContain(before.frontmatter.key);
  });

  it("old key still resolves through key_history", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    const id = await seed("A");
    const before = await lookupTask(locttDir, id);
    await moveTaskToProject({ locttDir, taskRef: id, targetProjectId: alt.id });
    const lookedUp = await lookupTask(locttDir, before.frontmatter.key);
    expect(lookedUp.frontmatter.id).toBe(id);
  });

  it("emits history entries for project and key", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    const id = await seed("A");
    const before = (await readHistory(locttDir, id)).length;
    await moveTaskToProject({ locttDir, taskRef: id, targetProjectId: alt.id });
    const h = await readHistory(locttDir, id);
    expect(h.length).toBe(before + 2);
    expect(h.some(e => e.kind === "field_change" && e.field === "project")).toBe(true);
    expect(h.some(e => e.kind === "field_change" && e.field === "key")).toBe(true);
  });

  it("no-op when target project equals source project", async () => {
    const id = await seed("A");
    const before = await lookupTask(locttDir, id);
    const beforeHistory = (await readHistory(locttDir, id)).length;
    const result = await moveTaskToProject({ locttDir, taskRef: id, targetProjectId: projectId });
    expect(result.newKey).toBe(before.frontmatter.key);
    const afterHistory = (await readHistory(locttDir, id)).length;
    expect(afterHistory).toBe(beforeHistory);
  });

  it("rejects unknown target project", async () => {
    const id = await seed("A");
    await expect(
      moveTaskToProject({ locttDir, taskRef: id, targetProjectId: "missing" }),
    ).rejects.toThrow(MoveTaskError);
  });

  it("rejects archived target project", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    await archiveProject(locttDir, alt.id);
    const id = await seed("A");
    await expect(
      moveTaskToProject({ locttDir, taskRef: id, targetProjectId: alt.id }),
    ).rejects.toThrow(/archived/);
  });
});

describe("bulkMoveTasksToProject", () => {
  it("moves a batch under one bulk_op_id", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    const a = await seed("A");
    const b = await seed("B");
    const result = await bulkMoveTasksToProject({
      locttDir, taskRefs: [a, b], targetProjectId: alt.id,
    });
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toEqual([]);
    for (const r of result.succeeded) {
      expect(r.newKey.startsWith("ALT-")).toBe(true);
      const h = await readHistory(locttDir, r.taskId);
      expect(h.some(e => e.bulk_op_id === result.bulk_op_id)).toBe(true);
    }
  });

  it("persists the key counter even when every write fails", async () => {
    // `performMove` consumes a key from `state` before `writeTask`, so a
    // failed write leaves the counter incremented in memory regardless.
    // `mutated` used to be set *after* the write, so whether that
    // increment survived depended on whether some other task in the
    // batch happened to succeed — the same failure produced two
    // different on-disk counters.
    //
    // Reissuing a consumed number is the dangerous direction: it
    // collides with a key the user may still hold in key_history (P-7).
    // A gap in the sequence is not.
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    const a = await seed("A");

    // Make the task directory unwritable so the write fails after the
    // key has already been allocated.
    const { chmod } = await import("node:fs/promises");
    const { getTaskDir } = await import("../paths/index.js");
    // `seed` returns the task id, which is what getTaskDir wants.
    const dir = getTaskDir(locttDir, a);
    await chmod(dir, 0o500);

    let after: number | undefined;
    try {
      const result = await bulkMoveTasksToProject({
        locttDir, taskRefs: [a], targetProjectId: alt.id,
      });
      // If the platform let the write through, this test proves nothing
      // — fail rather than pass vacuously.
      expect(result.failed, "expected the write to fail").toHaveLength(1);

      const { loadState } = await import("../state/state.js");
      after = (await loadState(locttDir)).keys[alt.id]?.next_number;
    } finally {
      await chmod(dir, 0o700);
    }

    // The consumed number is recorded, so the next allocation does not
    // reissue it.
    expect(after).toBeGreaterThan(1);
  });

  it("captures per-task failures", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    const a = await seed("A");
    const result = await bulkMoveTasksToProject({
      locttDir, taskRefs: [a, "NOPE-9999"], targetProjectId: alt.id,
    });
    expect(result.succeeded.map(r => r.taskId)).toEqual([a]);
    expect(result.failed).toHaveLength(1);
  });
});

/**
 * Appends a raw frontmatter line (e.g. an unrecognised top-level key)
 * to a seeded task's task.md, the way a hand edit reaches a field-local
 * corrupt state (K21). `readTask` then lifts it into `health`.
 */
async function injectFrontmatterLine(id: string, line: string): Promise<void> {
  const path = getTaskFilePath(locttDir, id);
  const content = await readFile(path, "utf-8");
  // Insert the line just before the closing `---` of the frontmatter.
  const parts = content.split(/\n---\n/);
  // parts[0] === "---\n<frontmatter body>" ; re-join with the new line.
  const patched = `${parts[0]}\n${line}\n---\n${parts.slice(1).join("\n---\n")}`;
  await writeFile(path, patched, "utf-8");
}

describe("move preserves a health-only corrupt field (write guard not bypassed)", () => {
  // @verifies phase-z finding #1: performMove used to rebuild the task as
  // {frontmatter, body} — dropping source.health — and both writeTask
  // calls passed the default ["*"] touched, so the write guard's rule 2
  // was skipped and an untouched corrupt/unrecognised field vanished
  // silently. The fix carries source.health and passes an explicit
  // touched set. Preserve-others / P-11.
  it("moveTaskToProject keeps an unrecognised top-level key on disk", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    const id = await seed("A");
    await injectFrontmatterLine(id, "jira_id: ABC-1");
    // Sanity: the hand-edited value is lifted into health, not frontmatter.
    const before = await lookupTask(locttDir, id);
    expect((before.health ?? []).some(h => h.field === "jira_id")).toBe(true);

    await moveTaskToProject({ locttDir, taskRef: id, targetProjectId: alt.id });

    const disk = await readFile(getTaskFilePath(locttDir, id), "utf-8");
    expect(disk).toContain("jira_id: ABC-1");
    const after = await lookupTask(locttDir, id);
    expect(after.frontmatter.project).toBe(alt.id);
    expect((after.health ?? []).some(h => h.field === "jira_id")).toBe(true);
  });

  it("bulkMoveTasksToProject keeps an unrecognised top-level key on disk", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
    const id = await seed("A");
    await injectFrontmatterLine(id, "jira_id: ABC-1");

    const res = await bulkMoveTasksToProject({
      locttDir, taskRefs: [id], targetProjectId: alt.id,
    });
    expect(res.failed).toEqual([]);
    expect(res.succeeded).toHaveLength(1);

    const disk = await readFile(getTaskFilePath(locttDir, id), "utf-8");
    expect(disk).toContain("jira_id: ABC-1");
  });
});

describe("move keeps the key index current", () => {
  // @verifies BLK-9
  it("resolves the new key after a move, not only the retired one", async () => {
    const ops = await createProject(locttDir, { name: "Ops", prefix: "OPS" });
    const id = await seed("Movable");
    const before = await lookupTask(locttDir, id);

    // Warm the index so the id is already in it. That is the state that
    // hid this: the index's lazy fold keys off unknown *ids*, and a move
    // keeps the id — so nothing detected the rekey. `loctt show OPS1`
    // returned "task not found" for a task just moved to OPS1, while
    // the retired key still worked, and `doctor` called the index in
    // sync because the entry count had not changed.
    await lookupTask(locttDir, before.frontmatter.key);

    const moved = await moveTaskToProject({
      locttDir, taskRef: before.frontmatter.key, targetProjectId: ops.id,
    });
    expect(moved.newKey).not.toBe(before.frontmatter.key);

    expect((await lookupTask(locttDir, moved.newKey)).frontmatter.id).toBe(id);
    // And the retired key keeps resolving (P-7).
    expect((await lookupTask(locttDir, before.frontmatter.key)).frontmatter.id).toBe(id);
  });
});
