import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SprintDef } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSprintsConfig } from "../config/sprints.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import {
  archiveSprint,
  createSprint,
  deleteSprint,
  editSprint,
  resolveSprintByName,
  resolveSprintIdFromInput,
  SprintError,
  unarchiveSprint,
} from "./manage.js";

let root: string;
let locttDir: string;
let taskProjectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-sprints-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const { loadProjectsConfig } = await import("../config/projects.js");
  const cfg = await loadProjectsConfig(locttDir);
  taskProjectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function createSampleSprint(name = "S-1"): Promise<SprintDef> {
  return createSprint(locttDir, {
    name,
    start_date: "2026-01-01",
    end_date: "2026-01-14",
    state: "future",
  });
}

describe("createSprint validation", () => {
  it("rejects malformed start_date at the manage layer", async () => {
    await expect(
      createSprint(locttDir, {
        name: "Sprint",
        start_date: "01/01/2026",
        end_date: "2026-01-14",
        state: "future",
      }),
    ).rejects.toThrow(SprintError);
  });

  it("rejects end_date before start_date", async () => {
    await expect(
      createSprint(locttDir, {
        name: "Sprint",
        start_date: "2026-01-14",
        end_date: "2026-01-01",
        state: "future",
      }),
    ).rejects.toThrow(SprintError);
  });

  it("rejects an unknown state", async () => {
    await expect(
      createSprint(locttDir, {
        name: "Sprint",
        start_date: "2026-01-01",
        end_date: "2026-01-14",
        state: "in_progress" as never,
      }),
    ).rejects.toThrow(SprintError);
  });

  it("allows duplicate names (disambiguated by id)", async () => {
    const a = await createSampleSprint("Twin");
    const b = await createSampleSprint("Twin");
    expect(a.id).not.toBe(b.id);
  });
});

describe("editSprint state transitions", () => {
  it("allows future -> active without force", async () => {
    const s = await createSampleSprint();
    await editSprint(locttDir, s.id, { state: "active" });
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.state).toBe("active");
  });

  it("blocks completed -> active without force", async () => {
    const s = await createSampleSprint();
    await editSprint(locttDir, s.id, { state: "completed" });
    await expect(
      editSprint(locttDir, s.id, { state: "active" }),
    ).rejects.toThrow(/not allowed/);
  });

  it("allows completed -> active with force: true", async () => {
    const s = await createSampleSprint();
    await editSprint(locttDir, s.id, { state: "completed" });
    await editSprint(locttDir, s.id, { state: "active", force: true });
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.state).toBe("active");
  });

  it("treats no-op state changes as fine even when completed", async () => {
    const s = await createSampleSprint();
    await editSprint(locttDir, s.id, { state: "completed" });
    await editSprint(locttDir, s.id, { state: "completed" });
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.state).toBe("completed");
  });

  it("rejects an edit that would put end_date before start_date", async () => {
    const s = await createSampleSprint();
    await expect(
      editSprint(locttDir, s.id, { end_date: "2025-12-31" }),
    ).rejects.toThrow(SprintError);
  });
});

describe("archiveSprint / unarchiveSprint", () => {
  it("sets archived: true and is reversible", async () => {
    const s = await createSampleSprint();
    await archiveSprint(locttDir, s.id);
    let cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.archived).toBe(true);

    await unarchiveSprint(locttDir, s.id);
    cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.archived).toBeUndefined();
  });

  it("is a no-op when already in the target state", async () => {
    const s = await createSampleSprint();
    await archiveSprint(locttDir, s.id);
    await archiveSprint(locttDir, s.id);
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.archived).toBe(true);
  });

  it("throws on unknown sprint", async () => {
    await expect(archiveSprint(locttDir, "01HXNOPE")).rejects.toThrow(SprintError);
    await expect(unarchiveSprint(locttDir, "01HXNOPE")).rejects.toThrow(SprintError);
  });
});

describe("deleteSprint (soft, default)", () => {
  it("sets archived: true and leaves task references intact", async () => {
    const s = await createSampleSprint();
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", sprint: s.id },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteSprint(locttDir, s.id);
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints[0]?.archived).toBe(true);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.sprint).toBe(s.id);
  });

  it("rejects --remap-to without --hard", async () => {
    const a = await createSampleSprint("S-1");
    const b = await createSampleSprint("S-2");
    await expect(
      deleteSprint(locttDir, a.id, { remapTo: b.id }),
    ).rejects.toThrow(/only applies to --hard/);
  });
});

describe("deleteSprint (hard)", () => {
  it("removes the sprint from sprints.yaml", async () => {
    const s = await createSampleSprint();
    const result = await deleteSprint(locttDir, s.id, { hard: true });
    expect(result.affectedTaskCount).toBe(0);
    const cfg = await loadSprintsConfig(locttDir);
    expect(cfg.sprints).toHaveLength(0);
  });

  it("clears sprint from affected tasks when no remap target", async () => {
    const s = await createSampleSprint();
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", sprint: s.id },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteSprint(locttDir, s.id, { hard: true });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.sprint).toBeUndefined();
  });

  it("remaps sprint to remap target on affected tasks", async () => {
    const a = await createSampleSprint("S-1");
    const b = await createSampleSprint("S-2");
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: taskProjectId, title: "t", sprint: a.id },
      });
      await saveState(locttDir, state);
    });

    const result = await deleteSprint(locttDir, a.id, { hard: true, remapTo: b.id });
    expect(result.affectedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.sprint).toBe(b.id);
  });

  it("rejects remap to self", async () => {
    const s = await createSampleSprint();
    await expect(
      deleteSprint(locttDir, s.id, { hard: true, remapTo: s.id }),
    ).rejects.toThrow(SprintError);
  });
});

describe("resolveSprintByName / resolveSprintIdFromInput", () => {
  it("resolves a single match by name", async () => {
    const s = await createSampleSprint("Q1");
    const cfg = await loadSprintsConfig(locttDir);
    expect(resolveSprintByName(cfg, "Q1").kind).toBe("match");
    expect(resolveSprintIdFromInput(cfg, "Q1")).toBe(s.id);
  });

  it("returns ambiguous for duplicate names", async () => {
    await createSampleSprint("Twin");
    await createSampleSprint("Twin");
    const cfg = await loadSprintsConfig(locttDir);
    expect(resolveSprintByName(cfg, "Twin").kind).toBe("ambiguous");
  });
});
