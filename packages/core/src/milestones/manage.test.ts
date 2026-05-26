import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadMilestonesConfig } from "../config/milestones.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import {
  archiveMilestone,
  createMilestone,
  deleteMilestone,
  MilestoneError,
  unarchiveMilestone,
} from "./manage.js";

let root: string;
let locttDir: string;
let taskProjectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-milestones-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const { loadProjectsConfig } = await import("../config/projects.js");
  const cfg = await loadProjectsConfig(locttDir);
  taskProjectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createMilestone", () => {
  it("appends to milestones.yaml", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    const cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones[0]).toEqual({ key: "v1", label: "V1.0" });
  });

  it("rejects duplicates", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    await expect(createMilestone(locttDir, { key: "v1", label: "Dup" })).rejects.toThrow(/already exists/);
  });
});

describe("archiveMilestone / unarchiveMilestone", () => {
  it("flips archived: true and back", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    await archiveMilestone(locttDir, "v1");
    let cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones[0]?.archived).toBe(true);

    await unarchiveMilestone(locttDir, "v1");
    cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones[0]?.archived).toBeUndefined();
  });

  it("throws on unknown milestone", async () => {
    await expect(archiveMilestone(locttDir, "nope")).rejects.toThrow(MilestoneError);
  });
});

describe("deleteMilestone (soft, default)", () => {
  it("sets archived: true and leaves task references intact", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: taskProjectId, title: "t", milestone: "v1" },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteMilestone(locttDir, "v1");
    expect(result.affectedTaskCount).toBe(0);

    const cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones[0]?.archived).toBe(true);

    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.milestone).toBe("v1");
  });

  it("rejects --remap-to without --hard", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    await createMilestone(locttDir, { key: "v2", label: "V2.0" });
    await expect(
      deleteMilestone(locttDir, "v1", { remapTo: "v2" }),
    ).rejects.toThrow(/only applies to --hard/);
  });
});

describe("deleteMilestone (hard)", () => {
  it("removes the milestone from milestones.yaml", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    const result = await deleteMilestone(locttDir, "v1", { hard: true });
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones).toHaveLength(0);
  });

  it("clears milestone from tasks when no remap target", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: taskProjectId, title: "t", milestone: "v1" },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteMilestone(locttDir, "v1", { hard: true });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.milestone).toBeUndefined();
  });

  it("remaps milestone to remap target", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    await createMilestone(locttDir, { key: "v2", label: "V2.0" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: taskProjectId, title: "t", milestone: "v1" },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteMilestone(locttDir, "v1", { hard: true, remapTo: "v2" });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.milestone).toBe("v2");
  });

  it("rejects remap to self", async () => {
    await createMilestone(locttDir, { key: "v1", label: "V1.0" });
    await expect(
      deleteMilestone(locttDir, "v1", { hard: true, remapTo: "v1" }),
    ).rejects.toThrow(MilestoneError);
  });
});
