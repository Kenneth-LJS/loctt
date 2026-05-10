import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/lookup.js";
import {
  createProject,
  deleteProject,
  editProject,
  ProjectError,
  resolveProjectKey,
  setDefaultProject,
} from "./manage.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-projects-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createProject", () => {
  it("appends to projects.yaml and adds a counter to state.yaml", async () => {
    await createProject(locttDir, { key: "backend", label: "Backend", prefix: "BACKEND-" });
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.projects.map(p => p.key)).toContain("backend");
    const state = await loadState(locttDir);
    expect(state.keys["backend"]).toEqual({ prefix: "BACKEND-", next_number: 1 });
  });

  it("rejects duplicate keys", async () => {
    await expect(
      createProject(locttDir, { key: "task", label: "X", prefix: "X-" }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects duplicate prefixes", async () => {
    await expect(
      createProject(locttDir, { key: "other", label: "Other", prefix: "T-" }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("editProject", () => {
  it("updates the label", async () => {
    await editProject(locttDir, "task", { label: "Renamed" });
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.projects.find(p => p.key === "task")?.label).toBe("Renamed");
  });

  it("throws when project doesn't exist", async () => {
    await expect(editProject(locttDir, "nope", { label: "x" })).rejects.toThrow(
      ProjectError,
    );
  });
});

describe("setDefaultProject", () => {
  it("changes the default", async () => {
    await createProject(locttDir, { key: "backend", label: "Backend", prefix: "BACKEND-" });
    await setDefaultProject(locttDir, "backend");
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.default).toBe("backend");
  });

  it("clears the default with null", async () => {
    await setDefaultProject(locttDir, null);
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.default).toBeUndefined();
  });

  it("rejects unknown project", async () => {
    await expect(setDefaultProject(locttDir, "nope")).rejects.toThrow(ProjectError);
  });
});

describe("deleteProject", () => {
  it("refuses to delete the only project", async () => {
    await expect(deleteProject(locttDir, "task")).rejects.toThrow(/only project/);
  });

  it("deletes a project that has no tasks", async () => {
    await createProject(locttDir, { key: "extra", label: "Extra", prefix: "X-" });
    const result = await deleteProject(locttDir, "extra");
    expect(result.remappedTaskCount).toBe(0);
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.projects.map(p => p.key)).not.toContain("extra");
    const state = await loadState(locttDir);
    expect(state.keys["extra"]).toBeUndefined();
  });

  it("requires remapTo when project has tasks", async () => {
    await createProject(locttDir, { key: "extra", label: "Extra", prefix: "X-" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "extra", title: "doomed" },
      });
      await saveState(locttDir, state);
    });
    await expect(deleteProject(locttDir, "extra")).rejects.toThrow(/pass remapTo/);
  });

  it("remaps affected tasks when remapTo is supplied", async () => {
    await createProject(locttDir, { key: "extra", label: "Extra", prefix: "X-" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "extra", title: "to-be-moved" },
      });
      await saveState(locttDir, state);
    });
    const result = await deleteProject(locttDir, "extra", { remapTo: "task" });
    expect(result.remappedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    const moved = tasks.find(t => t.frontmatter.title === "to-be-moved");
    expect(moved?.frontmatter.project).toBe("task");
    // The task's key (e.g. X-1) is preserved; only the `project`
    // field changes. Per the design, task keys are immutable.
    expect(moved?.frontmatter.key.startsWith("X-")).toBe(true);
  });

  it("rejects remap to self", async () => {
    await createProject(locttDir, { key: "extra", label: "Extra", prefix: "X-" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "extra", title: "x" },
      });
      await saveState(locttDir, state);
    });
    await expect(
      deleteProject(locttDir, "extra", { remapTo: "extra" }),
    ).rejects.toThrow(/differ/);
  });
});

describe("resolveProjectKey", () => {
  it("returns explicit when provided and known", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    expect(resolveProjectKey(cfg, { explicit: "task" })).toBe("task");
  });

  it("throws when explicit is unknown", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    expect(() => resolveProjectKey(cfg, { explicit: "nope" })).toThrow(ProjectError);
  });

  it("falls back to user default when no explicit", async () => {
    await createProject(locttDir, { key: "extra", label: "Extra", prefix: "X-" });
    const cfg = await loadProjectsConfig(locttDir);
    expect(resolveProjectKey(cfg, { userDefault: "extra" })).toBe("extra");
  });

  it("falls back to workspace default when user default is stale", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    expect(resolveProjectKey(cfg, { userDefault: "stale" })).toBe(cfg.default);
  });

  it("returns the only project when no defaults are set and one exists", async () => {
    await setDefaultProject(locttDir, null);
    const cfg = await loadProjectsConfig(locttDir);
    expect(resolveProjectKey(cfg)).toBe("task");
  });

  it("throws when ambiguous (multiple projects, no defaults)", async () => {
    await createProject(locttDir, { key: "extra", label: "Extra", prefix: "X-" });
    await setDefaultProject(locttDir, null);
    const cfg = await loadProjectsConfig(locttDir);
    expect(() => resolveProjectKey(cfg)).toThrow(/no default project/);
  });
});
