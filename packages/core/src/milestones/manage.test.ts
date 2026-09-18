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
  resolveMilestoneByName,
  resolveMilestoneIdFromInput,
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
  it("appends to milestones.yaml with a generated id", async () => {
    const def = await createMilestone(locttDir, { name: "V1.0" });
    const cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones[0]).toEqual({ id: def.id, name: "V1.0" });
  });

  it("allows duplicate names (disambiguated by id)", async () => {
    const a = await createMilestone(locttDir, { name: "Twin" });
    const b = await createMilestone(locttDir, { name: "Twin" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("archiveMilestone / unarchiveMilestone", () => {
  it("flips archived: true and back", async () => {
    const def = await createMilestone(locttDir, { name: "V1.0" });
    await archiveMilestone(locttDir, def.id);
    let cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones[0]?.archived).toBe(true);

    await unarchiveMilestone(locttDir, def.id);
    cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones[0]?.archived).toBeUndefined();
  });

  it("throws on unknown milestone", async () => {
    await expect(archiveMilestone(locttDir, "01HXNOPE")).rejects.toThrow(MilestoneError);
  });
});

describe("deleteMilestone (soft, default)", () => {
  it("sets archived: true and leaves task references intact", async () => {
    const def = await createMilestone(locttDir, { name: "V1.0" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", milestone: def.id },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteMilestone(locttDir, def.id);
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones[0]?.archived).toBe(true);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.milestone).toBe(def.id);
  });

  it("rejects --remap-to without --hard", async () => {
    const a = await createMilestone(locttDir, { name: "V1.0" });
    const b = await createMilestone(locttDir, { name: "V2.0" });
    await expect(
      deleteMilestone(locttDir, a.id, { remapTo: b.id }),
    ).rejects.toThrow(/only applies to --hard/);
  });
});

describe("deleteMilestone (hard)", () => {
  it("removes the milestone from milestones.yaml", async () => {
    const def = await createMilestone(locttDir, { name: "V1.0" });
    const result = await deleteMilestone(locttDir, def.id, { hard: true });
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadMilestonesConfig(locttDir);
    expect(cfg.milestones).toHaveLength(0);
  });

  it("clears milestone from tasks when no remap target", async () => {
    const def = await createMilestone(locttDir, { name: "V1.0" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", milestone: def.id },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteMilestone(locttDir, def.id, { hard: true });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.milestone).toBeUndefined();
  });

  it("remaps milestone to remap target", async () => {
    const a = await createMilestone(locttDir, { name: "V1.0" });
    const b = await createMilestone(locttDir, { name: "V2.0" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", milestone: a.id },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteMilestone(locttDir, a.id, { hard: true, remapTo: b.id });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.milestone).toBe(b.id);
  });

  it("rejects remap to self", async () => {
    const def = await createMilestone(locttDir, { name: "V1.0" });
    await expect(
      deleteMilestone(locttDir, def.id, { hard: true, remapTo: def.id }),
    ).rejects.toThrow(MilestoneError);
  });
});

describe("resolveMilestoneByName / resolveMilestoneIdFromInput", () => {
  it("resolves a single match by name", async () => {
    const def = await createMilestone(locttDir, { name: "v1 GA" });
    const cfg = await loadMilestonesConfig(locttDir);
    expect(resolveMilestoneByName(cfg, "v1 GA").kind).toBe("match");
    expect(resolveMilestoneIdFromInput(cfg, "v1 GA")).toBe(def.id);
  });

  it("returns ambiguous for duplicate names", async () => {
    await createMilestone(locttDir, { name: "Twin" });
    await createMilestone(locttDir, { name: "Twin" });
    const cfg = await loadMilestonesConfig(locttDir);
    expect(resolveMilestoneByName(cfg, "Twin").kind).toBe("ambiguous");
  });
});
