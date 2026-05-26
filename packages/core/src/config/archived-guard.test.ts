import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { archiveLabel, createLabel } from "../labels/manage.js";
import { archiveMilestone, createMilestone } from "../milestones/manage.js";
import { resolveLocttDir } from "../paths/index.js";
import { archiveProject, createProject } from "../projects/manage.js";
import { archiveSprint, createSprint } from "../sprints/manage.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { readTask, writeTask } from "../task/io.js";
import { setField } from "../task/update.js";
import { archiveUser } from "../users/lifecycle.js";
import { createUser } from "../users/lifecycle.js";
import {
  ArchivedReferenceError,
  loadArchivedGuardConfigs,
} from "./archived-guard.js";

let root: string;
let locttDir: string;
let taskProjectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-archived-guard-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const { loadProjectsConfig } = await import("./projects.js");
  const cfg = await loadProjectsConfig(locttDir);
  taskProjectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("archived-reference guard: createTask", () => {
  it("rejects createTask with an archived label", async () => {
    const bug = await createLabel(locttDir, { name: "Bug" });
    await archiveLabel(locttDir, bug.id);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    await expect(
      withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        try {
          await createTask({
            locttDir, state, archivedGuard,
            options: { project: taskProjectId, title: "T", labels: [bug.id] },
          });
        } finally {
          await saveState(locttDir, state);
        }
      }),
    ).rejects.toThrow(ArchivedReferenceError);
  });

  it("rejects createTask with an archived milestone", async () => {
    const v1 = await createMilestone(locttDir, { name: "v1" });
    await archiveMilestone(locttDir, v1.id);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    await expect(
      withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        try {
          await createTask({
            locttDir, state, archivedGuard,
            options: { project: taskProjectId, title: "T", milestone: v1.id },
          });
        } finally {
          await saveState(locttDir, state);
        }
      }),
    ).rejects.toThrow(new RegExp(`archived milestone "${v1.id}"`));
  });

  it("rejects createTask with an archived sprint", async () => {
    const s1 = await createSprint(locttDir, {
      name: "Sprint 1",
      start_date: "2026-05-01",
      end_date: "2026-05-14",
      state: "future",
    });
    await archiveSprint(locttDir, s1.id);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    await expect(
      withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        try {
          await createTask({
            locttDir, state, archivedGuard,
            options: { project: taskProjectId, title: "T", sprint: s1.id },
          });
        } finally {
          await saveState(locttDir, state);
        }
      }),
    ).rejects.toThrow(new RegExp(`archived sprint "${s1.id}"`));
  });

  it("rejects createTask with an archived assignee", async () => {
    const user = await createUser(locttDir, { name: "Sara" });
    await archiveUser(locttDir, user.id);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    await expect(
      withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        try {
          await createTask({
            locttDir, state, archivedGuard,
            options: { project: taskProjectId, title: "T", assignee: user.id },
          });
        } finally {
          await saveState(locttDir, state);
        }
      }),
    ).rejects.toThrow(/archived user/);
  });

  it("rejects createTask with an archived reporter", async () => {
    const user = await createUser(locttDir, { name: "Sara" });
    await archiveUser(locttDir, user.id);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    await expect(
      withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        try {
          await createTask({
            locttDir, state, archivedGuard,
            options: { project: taskProjectId, title: "T", reporter: user.id },
          });
        } finally {
          await saveState(locttDir, state);
        }
      }),
    ).rejects.toThrow(/archived user/);
  });

  it("rejects createTask with an archived project", async () => {
    const alt = await createProject(locttDir, { name: "Alt", prefix: "A-" });
    await archiveProject(locttDir, alt.id);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    await expect(
      withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        try {
          await createTask({
            locttDir, state, archivedGuard,
            options: { project: alt.id, title: "T" },
          });
        } finally {
          await saveState(locttDir, state);
        }
      }),
    ).rejects.toThrow(new RegExp(`archived project "${alt.id}"`));
  });

  it("permits createTask when references are live", async () => {
    const bug = await createLabel(locttDir, { name: "Bug" });
    const v1 = await createMilestone(locttDir, { name: "v1" });
    const user = await createUser(locttDir, { name: "Sara" });
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    const task = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const created = await createTask({
        locttDir, state, archivedGuard,
        options: {
          project: taskProjectId, title: "T",
          labels: [bug.id], milestone: v1.id, assignee: user.id,
        },
      });
      await saveState(locttDir, state);
      return created;
    });
    expect(task.frontmatter.labels).toEqual([bug.id]);
    expect(task.frontmatter.milestone).toBe(v1.id);
  });

  it("is a no-op when archivedGuard is not provided", async () => {
    const bug = await createLabel(locttDir, { name: "Bug" });
    await archiveLabel(locttDir, bug.id);

    const task = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const created = await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "T", labels: [bug.id] },
      });
      await saveState(locttDir, state);
      return created;
    });
    expect(task.frontmatter.labels).toEqual([bug.id]);
  });
});

describe("archived-reference guard: setField", () => {
  async function createBaseTask(): Promise<string> {
    const created = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const t = await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "T" },
      });
      await saveState(locttDir, state);
      return t;
    });
    return created.frontmatter.id;
  }

  it("rejects assigning an archived milestone via setField", async () => {
    const taskId = await createBaseTask();
    const v1 = await createMilestone(locttDir, { name: "v1" });
    await archiveMilestone(locttDir, v1.id);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    await expect(
      setField({ locttDir, taskId, field: "milestone", value: v1.id, archivedGuard }),
    ).rejects.toThrow(ArchivedReferenceError);
  });

  it("rejects adding an archived label via setField", async () => {
    const taskId = await createBaseTask();
    const bug = await createLabel(locttDir, { name: "Bug" });
    await archiveLabel(locttDir, bug.id);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);

    await expect(
      setField({ locttDir, taskId, field: "labels", value: [bug.id], archivedGuard }),
    ).rejects.toThrow(new RegExp(`archived label "${bug.id}"`));
  });

  it("preserves an existing label that was archived AFTER the task referenced it", async () => {
    const taskId = await createBaseTask();
    const bug = await createLabel(locttDir, { name: "Bug" });
    const guard1 = await loadArchivedGuardConfigs(locttDir);
    await setField({ locttDir, taskId, field: "labels", value: [bug.id], archivedGuard: guard1 });
    await archiveLabel(locttDir, bug.id);
    const guard2 = await loadArchivedGuardConfigs(locttDir);

    const updated = await setField({
      locttDir, taskId, field: "title", value: "renamed", archivedGuard: guard2,
    });
    expect(updated.frontmatter.title).toBe("renamed");
    expect(updated.frontmatter.labels).toEqual([bug.id]);
  });

  it("preserves an existing milestone that was archived after assignment", async () => {
    const taskId = await createBaseTask();
    const v1 = await createMilestone(locttDir, { name: "v1" });
    const guard1 = await loadArchivedGuardConfigs(locttDir);
    await setField({ locttDir, taskId, field: "milestone", value: v1.id, archivedGuard: guard1 });
    await archiveMilestone(locttDir, v1.id);
    const guard2 = await loadArchivedGuardConfigs(locttDir);

    const updated = await setField({
      locttDir, taskId, field: "title", value: "renamed", archivedGuard: guard2,
    });
    expect(updated.frontmatter.milestone).toBe(v1.id);
  });

  it("blocks ADDING a second label when the new label is archived (preserves existing)", async () => {
    const taskId = await createBaseTask();
    const live = await createLabel(locttDir, { name: "Live" });
    const dead = await createLabel(locttDir, { name: "Dead" });
    const guard1 = await loadArchivedGuardConfigs(locttDir);
    await setField({ locttDir, taskId, field: "labels", value: [live.id], archivedGuard: guard1 });
    await archiveLabel(locttDir, dead.id);
    const guard2 = await loadArchivedGuardConfigs(locttDir);

    await expect(
      setField({
        locttDir, taskId, field: "labels", value: [live.id, dead.id],
        archivedGuard: guard2,
      }),
    ).rejects.toThrow(new RegExp(`archived label "${dead.id}"`));

    const onDisk = await readTask(locttDir, taskId);
    expect(onDisk.frontmatter.labels).toEqual([live.id]);
  });
});

describe("archived-reference guard: linkTask", () => {
  async function makePair(): Promise<{ a: string; b: string }> {
    const state = await loadState(locttDir);
    const a = await createTask({ locttDir, state, options: { project: taskProjectId, title: "A" } });
    const b = await createTask({ locttDir, state, options: { project: taskProjectId, title: "B" } });
    await saveState(locttDir, state);
    return { a: a.frontmatter.id, b: b.frontmatter.id };
  }

  it("rejects linking to an archived target task", async () => {
    const { a, b } = await withStateLock(locttDir, makePair);
    const bTask = await readTask(locttDir, b);
    await writeTask(locttDir, b, {
      ...bTask,
      frontmatter: { ...bTask.frontmatter, archived: true, archived_at: new Date().toISOString() },
    });

    const { linkTask } = await import("../task/relationships.js");
    await expect(
      linkTask({ locttDir, taskId: a, type: "blocks", target: b }),
    ).rejects.toThrow(/archived task/);
  });

  it("permits linking to a live target task", async () => {
    const { a, b } = await withStateLock(locttDir, makePair);
    const { linkTask } = await import("../task/relationships.js");
    const result = await linkTask({ locttDir, taskId: a, type: "blocks", target: b });
    expect(result.frontmatter.relationships?.some(r => r.target === b)).toBe(true);
  });

  it("bypass: blockArchivedTarget=false allows linking to an archived task", async () => {
    const { a, b } = await withStateLock(locttDir, makePair);
    const bTask = await readTask(locttDir, b);
    await writeTask(locttDir, b, {
      ...bTask,
      frontmatter: { ...bTask.frontmatter, archived: true, archived_at: new Date().toISOString() },
    });

    const { linkTask } = await import("../task/relationships.js");
    const result = await linkTask({
      locttDir, taskId: a, type: "blocks", target: b, blockArchivedTarget: false,
    });
    expect(result.frontmatter.relationships?.some(r => r.target === b)).toBe(true);
  });
});
