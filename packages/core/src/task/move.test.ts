import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
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
