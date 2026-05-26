import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import {
  createProject,
  deleteProject,
  editProject,
  ProjectError,
  resolveProjectByName,
  resolveProjectId,
  resolveProjectIdFromInput,
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

/** Helper: pick the seeded "Tasks" project's id from a fresh init. */
async function defaultProjectId(): Promise<string> {
  const cfg = await loadProjectsConfig(locttDir);
  const initial = cfg.projects[0];
  if (!initial) throw new Error("test setup: no initial project");
  return initial.id;
}

describe("createProject", () => {
  it("appends to projects.yaml and adds a counter to state.yaml keyed by id", async () => {
    const def = await createProject(locttDir, { name: "Backend", prefix: "BACKEND-" });
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.projects.some(p => p.id === def.id && p.name === "Backend")).toBe(true);
    const state = await loadState(locttDir);
    expect(state.keys[def.id]).toEqual({ prefix: "BACKEND-", next_number: 1 });
  });

  it("generates a fresh ULID for each project", async () => {
    const a = await createProject(locttDir, { name: "A", prefix: "A-" });
    const b = await createProject(locttDir, { name: "B", prefix: "B-" });
    expect(a.id).not.toBe(b.id);
  });

  it("rejects duplicate prefixes", async () => {
    await expect(
      createProject(locttDir, { name: "Other", prefix: "T-" }),
    ).rejects.toThrow(/already exists/);
  });

  it("allows duplicate names (disambiguated by id)", async () => {
    await createProject(locttDir, { name: "Web", prefix: "WEB-" });
    await createProject(locttDir, { name: "Web", prefix: "WEB2-" });
    const cfg = await loadProjectsConfig(locttDir);
    const matches = cfg.projects.filter(p => p.name === "Web");
    expect(matches).toHaveLength(2);
    expect(matches[0]?.id).not.toBe(matches[1]?.id);
  });
});

describe("editProject", () => {
  it("updates the name", async () => {
    const id = await defaultProjectId();
    await editProject(locttDir, id, { name: "Renamed" });
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.projects.find(p => p.id === id)?.name).toBe("Renamed");
  });

  it("throws when project doesn't exist", async () => {
    await expect(editProject(locttDir, "01HX000NONE", { name: "x" })).rejects.toThrow(
      ProjectError,
    );
  });
});

describe("setDefaultProject", () => {
  it("changes the default by id", async () => {
    const def = await createProject(locttDir, { name: "Backend", prefix: "BACKEND-" });
    await setDefaultProject(locttDir, def.id);
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.default).toBe(def.id);
  });

  it("changes the default by name when unambiguous", async () => {
    const def = await createProject(locttDir, { name: "Backend", prefix: "BACKEND-" });
    await setDefaultProject(locttDir, "Backend");
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.default).toBe(def.id);
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

describe("deleteProject (soft, default)", () => {
  it("sets archived: true and leaves task references intact", async () => {
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: extra.id, title: "t" } });
      await saveState(locttDir, state);
    });
    const result = await deleteProject(locttDir, extra.id);
    expect(result.remappedTaskCount).toBe(0);
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.projects.find(p => p.id === extra.id)?.archived).toBe(true);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.project).toBe(extra.id);
    // Counter still in `keys`, not retired.
    const state = await loadState(locttDir);
    expect(state.keys[extra.id]).toBeDefined();
    expect(state.retired_keys?.[extra.id]).toBeUndefined();
  });

  it("rejects --remap-to without --hard", async () => {
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });
    const main = await defaultProjectId();
    await expect(
      deleteProject(locttDir, extra.id, { remapTo: main }),
    ).rejects.toThrow(/only applies to --hard/);
  });
});

describe("deleteProject (hard)", () => {
  it("refuses to delete the only project", async () => {
    const id = await defaultProjectId();
    await expect(deleteProject(locttDir, id, { hard: true })).rejects.toThrow(/only project/);
  });

  it("hard-deletes a project that has no tasks and retires its counter", async () => {
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });
    const result = await deleteProject(locttDir, extra.id, { hard: true });
    expect(result.remappedTaskCount).toBe(0);
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.projects.some(p => p.id === extra.id)).toBe(false);
    const state = await loadState(locttDir);
    expect(state.keys[extra.id]).toBeUndefined();
    expect(state.retired_keys?.[extra.id]).toEqual({ prefix: "X-", next_number: 1 });
  });

  it("requires remapTo when project has tasks", async () => {
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: extra.id, title: "doomed" } });
      await saveState(locttDir, state);
    });
    await expect(deleteProject(locttDir, extra.id, { hard: true })).rejects.toThrow(/pass remapTo/);
  });

  it("remaps affected tasks when remapTo is supplied", async () => {
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });
    const main = await defaultProjectId();
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: extra.id, title: "to-be-moved" } });
      await saveState(locttDir, state);
    });
    const result = await deleteProject(locttDir, extra.id, { hard: true, remapTo: main });
    expect(result.remappedTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    const moved = tasks.find(t => t.frontmatter.title === "to-be-moved");
    expect(moved?.frontmatter.project).toBe(main);
    // The task's key (e.g. X-1) is preserved; only the `project`
    // field changes. Task keys remain immutable under deleteProject.
    expect(moved?.frontmatter.key.startsWith("X-")).toBe(true);
  });

  it("rejects remap to self", async () => {
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: extra.id, title: "x" } });
      await saveState(locttDir, state);
    });
    await expect(
      deleteProject(locttDir, extra.id, { hard: true, remapTo: extra.id }),
    ).rejects.toThrow(/differ/);
  });
});

describe("resolveProjectByName", () => {
  it("returns a single match when unambiguous", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    const result = resolveProjectByName(cfg, "Tasks");
    expect(result.kind).toBe("match");
    if (result.kind === "match") expect(result.project.name).toBe("Tasks");
  });

  it("returns not_found for unknown names", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    expect(resolveProjectByName(cfg, "Nope").kind).toBe("not_found");
  });

  it("returns ambiguous when multiple projects share a name", async () => {
    await createProject(locttDir, { name: "Twin", prefix: "T1-" });
    await createProject(locttDir, { name: "Twin", prefix: "T2-" });
    const cfg = await loadProjectsConfig(locttDir);
    const result = resolveProjectByName(cfg, "Twin");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.matches).toHaveLength(2);
  });

  it("excludes archived projects by default", async () => {
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });
    await deleteProject(locttDir, extra.id); // soft = archive
    const cfg = await loadProjectsConfig(locttDir);
    expect(resolveProjectByName(cfg, "Extra").kind).toBe("not_found");
    expect(resolveProjectByName(cfg, "Extra", { includeArchived: true }).kind).toBe("match");
  });
});

describe("resolveProjectIdFromInput", () => {
  it("resolves a name to an id", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    const expected = cfg.projects[0]?.id;
    expect(resolveProjectIdFromInput(cfg, "Tasks")).toBe(expected);
  });

  it("returns the id when given an id directly", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    const id = cfg.projects[0]?.id as string;
    expect(resolveProjectIdFromInput(cfg, id)).toBe(id);
  });

  it("throws on ambiguous name", async () => {
    await createProject(locttDir, { name: "Twin", prefix: "T1-" });
    await createProject(locttDir, { name: "Twin", prefix: "T2-" });
    const cfg = await loadProjectsConfig(locttDir);
    expect(() => resolveProjectIdFromInput(cfg, "Twin")).toThrow(/ambiguous/);
  });

  it("throws on unknown input", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    expect(() => resolveProjectIdFromInput(cfg, "Nope")).toThrow(/unknown/);
  });
});

describe("resolveProjectId", () => {
  it("returns explicit when provided and known", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    const id = cfg.projects[0]?.id as string;
    expect(resolveProjectId(cfg, { explicit: id })).toBe(id);
  });

  it("accepts explicit as a name", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    const id = cfg.projects[0]?.id;
    expect(resolveProjectId(cfg, { explicit: "Tasks" })).toBe(id);
  });

  it("throws when explicit is unknown", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    expect(() => resolveProjectId(cfg, { explicit: "nope" })).toThrow(ProjectError);
  });

  it("falls back to user default when no explicit", async () => {
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });
    const cfg = await loadProjectsConfig(locttDir);
    expect(resolveProjectId(cfg, { userDefault: extra.id })).toBe(extra.id);
  });

  it("falls back to workspace default when user default is stale", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    expect(resolveProjectId(cfg, { userDefault: "01HX000STALE" })).toBe(cfg.default);
  });

  it("returns the only project when no defaults are set and one exists", async () => {
    await setDefaultProject(locttDir, null);
    const cfg = await loadProjectsConfig(locttDir);
    const id = cfg.projects[0]?.id;
    expect(resolveProjectId(cfg)).toBe(id);
  });

  it("throws when ambiguous (multiple projects, no defaults)", async () => {
    await createProject(locttDir, { name: "Extra", prefix: "X-" });
    await setDefaultProject(locttDir, null);
    const cfg = await loadProjectsConfig(locttDir);
    expect(() => resolveProjectId(cfg)).toThrow(/no default project/);
  });
});
