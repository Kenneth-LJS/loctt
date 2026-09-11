import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import { createUser } from "../users/lifecycle.js";
import { switchCurrentUser } from "../users/manage.js";
import { saveUserSettings } from "../users/settings.js";
import {
  createProject,
  deleteProject,
  editProject,
  PartialRemapError,
  projectDefaultIsGhost,
  ProjectError,
  resolveProjectByName,
  resolveProjectId,
  resolveProjectIdForUser,
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

/**
 * Removes `default` from projects.yaml.
 *
 * `setDefaultProject` can only *set* one, so peeling this rung means
 * writing the config without it.
 */
async function clearDefaultProject(): Promise<void> {
  const cfg = await loadProjectsConfig(locttDir);
  const { saveProjectsConfig } = await import("../config/projects.js");
  await saveProjectsConfig(locttDir, { projects: cfg.projects });
}

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

  /**
   * PRU-18: re-creating a project on a hard-deleted project's prefix
   * resumes its numbering instead of restarting at 1.
   *
   * Seeded so a wrong implementation looks different: the deleted
   * project allocates three keys (X-1..X-3, counter left at 4), and
   * the surviving task keeps `X-2`. A `createProject` that restarts at
   * 1 would mint `X-1` here — a key that is one below a live one and
   * on a direct path to colliding with it — so the assertion is on the
   * *number*, not merely on "it did not throw".
   */
  // @verifies PRU-18
  it("PRU-18: re-creating a project on a retired prefix resumes its counter", async () => {
    const main = await defaultProjectId();
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });

    // Allocate X-1, X-2, X-3 in the doomed project.
    const keys: string[] = [];
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      for (const title of ["one", "two", "three"]) {
        const t = await createTask({
          locttDir,
          state,
          options: { project: extra.id, title },
        });
        keys.push(t.frontmatter.key);
      }
      await saveState(locttDir, state);
    });
    expect(keys).toEqual(["X-1", "X-2", "X-3"]);

    await deleteProject(locttDir, extra.id, { hard: true, remapTo: main });

    // The counter is retired at its high-water mark, not lost.
    const retired = await loadState(locttDir);
    expect(retired.retired_keys?.[extra.id]).toEqual({ prefix: "X-", next_number: 4 });

    // Re-create on the same prefix.
    const reborn = await createProject(locttDir, { name: "Extra Again", prefix: "X-" });

    // The far end, read off state.yaml: the counter is back under
    // `keys` at the retired high-water mark, and no longer retired.
    const after = await loadState(locttDir);
    expect(after.keys[reborn.id]).toEqual({ prefix: "X-", next_number: 4 });
    expect(after.retired_keys?.[extra.id]).toBeUndefined();

    // And the observable consequence: the first task minted in the
    // re-created project continues the sequence rather than colliding
    // with the surviving X-2.
    let mintedKey = "";
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const t = await createTask({
        locttDir,
        state,
        options: { project: reborn.id, title: "after rebirth" },
      });
      mintedKey = t.frontmatter.key;
      await saveState(locttDir, state);
    });
    expect(mintedKey).toBe("X-4");

    // The surviving task still holds X-2, unshadowed by any new task.
    const all = await loadAllTasks(locttDir);
    const withX2 = all.filter(t => t.frontmatter.key === "X-2");
    expect(withX2).toHaveLength(1);
  });

  /**
   * PRU-34: a remap that fails partway reports the true split and
   * leaves the project in place.
   *
   * The failure is induced by making one task's *directory*
   * read-only, so `writeTask` genuinely cannot replace the file. That
   * is a real write failure rather than a stubbed one, which matters:
   * the behaviour under test is what the loop does when a write
   * throws, and a mock of `writeTask` would be testing the mock.
   *
   * Seeded with four tasks so "some moved, some did not" is
   * distinguishable from both "none moved" and "all moved" — with one
   * task each of those collapses to the same observation.
   */
  // @verifies PRU-34
  it("PRU-34: a partial remap reports the split and does not delete the project", async () => {
    const main = await defaultProjectId();
    const extra = await createProject(locttDir, { name: "Extra", prefix: "X-" });

    const made: { key: string; id: string }[] = [];
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      for (const title of ["a", "b", "c", "d"]) {
        const t = await createTask({
          locttDir,
          state,
          options: { project: extra.id, title },
        });
        made.push({ key: t.frontmatter.key, id: t.frontmatter.id });
      }
      await saveState(locttDir, state);
    });

    // Make exactly one task unwritable.
    const victim = made[1] as { key: string; id: string };
    const victimDir = join(locttDir, "tasks", victim.id);
    await chmod(victimDir, 0o500);

    let err: unknown;
    try {
      await deleteProject(locttDir, extra.id, { hard: true, remapTo: main });
    } catch (e) {
      err = e;
    } finally {
      await chmod(victimDir, 0o700);
    }

    // It names the split and the offending task by key — not a bare
    // failure, and not "Project deleted".
    expect(err).toBeInstanceOf(PartialRemapError);
    const partial = err as PartialRemapError;
    expect(partial.remapped).toBe(3);
    expect(partial.failedKeys).toEqual([victim.key]);
    expect(partial.message).toContain(victim.key);
    expect(partial.message).toMatch(/not been deleted/i);
    expect(partial.recovery).toEqual({ kind: "retry" });

    // The project is still in projects.yaml — removing it would have
    // stranded the task that did not move.
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.projects.some(p => p.id === extra.id)).toBe(true);

    // And the far end on disk: three tasks moved, the victim did not.
    const all = await loadAllTasks(locttDir);
    const stillExtra = all.filter(t => t.frontmatter.project === extra.id);
    expect(stillExtra.map(t => t.frontmatter.key)).toEqual([victim.key]);

    // Retry is genuinely safe, and finishes the job. The journal
    // entry survived the partial failure, so the next critical
    // section's recovery hook replays it — the remaining task moves
    // and the project is removed. Either route reaches the same
    // place, which is what makes offering Retry honest; the assertion
    // is on the end state rather than on which of the two got there.
    await withStateLock(locttDir, async () => { /* trigger recovery */ });

    const after = await loadProjectsConfig(locttDir);
    expect(after.projects.some(p => p.id === extra.id)).toBe(false);
    const moved = await loadAllTasks(locttDir);
    expect(moved.filter(t => t.frontmatter.project === extra.id)).toHaveLength(0);
    // The task that had failed is now on the target project, keeping
    // its own key — nothing was renumbered by the recovery.
    const healed = moved.find(t => t.frontmatter.key === victim.key);
    expect(healed?.frontmatter.project).toBe(main);
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

/**
 * PRU-15: the resolution order, peeled one rung at a time.
 *
 * Exercised through `resolveProjectIdForUser` because that is the
 * single function the web server, the CLI and the MCP server all call
 * (`server.ts`, `task-crud.ts`, `tools/task-crud.ts`) — so "the UI has
 * not invented its own order" is a property of there being one
 * implementation, and this is it.
 *
 * Each rung is removed in turn and the answer must change to the next
 * one down. Seeding matters here: the workspace default and the user
 * default are deliberately set to *different* projects, so an
 * implementation that consulted them in the wrong order would return a
 * visibly different id rather than the same one by luck.
 */
describe("resolveProjectIdForUser (PRU-15)", () => {
  // @verifies PRU-15
  it("PRU-15: explicit > user default > workspace default > sole project", async () => {
    const tasks = await defaultProjectId();
    const web = await createProject(locttDir, { name: "Web", prefix: "WEB-" });
    const backend = await createProject(locttDir, { name: "Backend", prefix: "BE-" });

    const user = await createUser(locttDir, { name: "Alice" });
    await switchCurrentUser(locttDir, user.id);

    // Workspace default = web; user default = backend. Different, so
    // the two rungs are distinguishable.
    await setDefaultProject(locttDir, web.id);
    await saveUserSettings(locttDir, user.id, { default_project: backend.id });

    // 1. Explicit wins over both.
    expect(await resolveProjectIdForUser(locttDir, web.id)).toBe(web.id);
    // ...and an explicit choice that is NOT either default still wins,
    // which a "prefer a default when one exists" bug would break.
    expect(await resolveProjectIdForUser(locttDir, tasks)).toBe(tasks);

    // 2. No explicit → the user's default, not the workspace's.
    expect(await resolveProjectIdForUser(locttDir)).toBe(backend.id);

    // 3. Clear the personal default → falls to the workspace default.
    await saveUserSettings(locttDir, user.id, {});
    expect(await resolveProjectIdForUser(locttDir)).toBe(web.id);

    // 4. Remove the workspace default with several projects → no
    // guessing. (The sole-project rung is checked below; with three
    // projects present it must NOT silently pick one.)
    await clearDefaultProject();
    await expect(resolveProjectIdForUser(locttDir)).rejects.toThrow(/no default project/);
  });

  // @verifies PRU-15
  it("PRU-15: with no default anywhere and exactly one project, it picks that one", async () => {
    const tasks = await defaultProjectId();
    await clearDefaultProject();
    // A fresh tracker has exactly one project, so this is the last
    // rung reached only once every rung above it is empty.
    expect(await resolveProjectIdForUser(locttDir)).toBe(tasks);
  });
});

/**
 * NEW-20 / K23: a workspace `default:` naming a project that no longer
 * exists is tolerated drift, not a config error. It must (a) still
 * load, (b) be reported as drift, and (c) be *ignored* by resolution —
 * which falls through to the unique-single rung and then the ask
 * state, never returning the ghost id (that would file the task into a
 * nonexistent project and burn the wrong key counter).
 *
 * The ghost is written straight to projects.yaml because no API can
 * create one — `setDefaultProject` validates. That is exactly how the
 * drift arises in the wild: a hand-edit, or a rename that left the
 * pointer behind.
 */
describe("ghost workspace default (NEW-20 / K23)", () => {
  async function writeGhostDefault(): Promise<void> {
    const { writeFile } = await import("node:fs/promises");
    const cfg = await loadProjectsConfig(locttDir);
    const { getProjectsConfigPath } = await import("../config/projects.js");
    const { stringify } = await import("yaml");
    await writeFile(
      getProjectsConfigPath(locttDir),
      stringify({
        projects: cfg.projects.map(p => ({
          id: p.id, name: p.name, prefix: p.prefix,
          ...(p.slug !== undefined ? { slug: p.slug } : {}),
        })),
        default: "PROJ-does-not-exist",
      }),
      "utf8",
    );
  }

  // @verifies NEW-20
  it("NEW-20: a ghost default still loads and is reported as drift, not rejected", async () => {
    await writeGhostDefault();
    // The load must NOT throw — before K23 the schema's superRefine
    // rejected this and the whole projects surface went dark.
    const cfg = await loadProjectsConfig(locttDir);
    expect(cfg.default).toBe("PROJ-does-not-exist");
    expect(projectDefaultIsGhost(cfg)).toBe(true);
  });

  // @verifies NEW-20
  it("NEW-20: resolution ignores a ghost default and falls to the ask state when several projects exist", async () => {
    await createProject(locttDir, { name: "Web", prefix: "WEB-" });
    await writeGhostDefault();
    // Two projects + a default that resolves to nothing = no defensible
    // answer. The resolver must throw (the ask state), NOT return the
    // ghost id. A resolver that returned `config.default` blindly would
    // resolve to "PROJ-does-not-exist" and file the task there.
    //
    // K75: the message must NAME the ghost default as the cause, not just
    // say "no default configured" — the previous assertion (/no default
    // project/) encoded the less-diagnostic message this fix improves.
    await expect(resolveProjectIdForUser(locttDir)).rejects.toThrow(/no longer exists/);
  });

  // @verifies NEW-20
  it("NEW-20 (K75): the ask-state error names the ghost default and points at projects.yaml", async () => {
    await createProject(locttDir, { name: "Web", prefix: "WEB-" });
    await writeGhostDefault();
    await expect(resolveProjectIdForUser(locttDir)).rejects.toThrow(/projects\.yaml/);
  });

  // @verifies NEW-20
  it("NEW-20: with exactly one project a ghost default falls through to that sole project", async () => {
    const tasks = await defaultProjectId();
    await writeGhostDefault();
    // One project and a ghost default: the ask state would be busywork,
    // so it lands on the sole project — reached only because the ghost
    // is skipped rather than returned.
    expect(await resolveProjectIdForUser(locttDir)).toBe(tasks);
  });

  it("a real default is not flagged as drift", async () => {
    const cfg = await loadProjectsConfig(locttDir);
    expect(projectDefaultIsGhost(cfg)).toBe(false);
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
