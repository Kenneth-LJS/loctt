import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getProjectsConfigPath, loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { getPrefixRenameStatePath, resolveLocttDir } from "../paths/index.js";
import { loadState } from "../state/state.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import { lookupByKey } from "../task/lookup.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { createProject, ProjectError, resolveProjectIdForUser } from "./manage.js";
import {
  completeInterruptedPrefixRename,
  readPrefixRenameState,
  recoverInterruptedPrefixRename,
  setProjectPrefix,
} from "./prefix.js";

/**
 * @verifies PRU-C10, PRU-C11, PRU-C12
 *
 * The prefix lives in four places that must agree — projects.yaml, the
 * state counter, every task's key, and the key index. Each test here
 * names which of those a regression would break.
 */

let root: string;
let locttDir: string;

async function seed(count: number, project: string): Promise<void> {
  const { loadState: load, saveState } = await import("../state/state.js");
  const state = await load(locttDir);
  for (let i = 0; i < count; i += 1) {
    await createTask({
      locttDir,
      state,
      options: { project, title: `task ${i}` },
    });
  }
  await saveState(locttDir, state);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-prefix-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("setProjectPrefix", () => {
  it("renames every task in the project, preserving the number", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(3, project);

    const result = await setProjectPrefix(locttDir, project, "WEB-");

    expect(result.renamed).toBe(3);
    const tasks = await loadAllTasks(locttDir);
    const keys = tasks.map(t => t.frontmatter.key).sort();
    // Numbers preserved — renumbering would break every reference a user
    // has written down.
    expect(keys).toEqual(["WEB-1", "WEB-2", "WEB-3"]);
  });

  it("keeps the old key resolvable through key_history", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(1, project);

    await setProjectPrefix(locttDir, project, "WEB-");

    const byOldKey = await lookupByKey(locttDir, "T-1");
    expect(byOldKey.frontmatter.key).toBe("WEB-1");
    expect(byOldKey.frontmatter.key_history).toContain("T-1");
  });

  it("carries the counter over so the next task does not reuse a key", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(3, project);

    await setProjectPrefix(locttDir, project, "WEB-");

    const state = await loadState(locttDir);
    expect(state.keys[project]?.prefix).toBe("WEB-");
    // Three keys handed out, so the next is 4 — resetting the counter
    // would reissue WEB-1 over a task that already exists.
    expect(state.keys[project]?.next_number).toBe(4);
  });

  it("updates the declared prefix in projects.yaml", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await setProjectPrefix(locttDir, project, "WEB-");

    const config = await loadProjectsConfig(locttDir);
    expect(config.projects.find(p => p.id === project)?.prefix).toBe("WEB-");
  });

  it("leaves other projects' tasks untouched", async () => {
    const first = await resolveProjectIdForUser(locttDir);
    const other = await createProject(locttDir, { name: "API", prefix: "API-" });
    await seed(1, first);
    await seed(1, other.id);

    await setProjectPrefix(locttDir, first, "WEB-");

    const tasks = await loadAllTasks(locttDir);
    const apiTask = tasks.find(t => t.frontmatter.project === other.id);
    expect(apiTask?.frontmatter.key).toBe("API-1");
    expect(apiTask?.frontmatter.key_history).toBeUndefined();
  });

  it("refuses a prefix another project already holds, writing nothing", async () => {
    const first = await resolveProjectIdForUser(locttDir);
    await createProject(locttDir, { name: "API", prefix: "API-" });
    await seed(2, first);

    await expect(setProjectPrefix(locttDir, first, "API-")).rejects.toThrow(
      ProjectError,
    );

    // Refused before any write: prefixes partition the key space, so a
    // duplicate makes keys ambiguous.
    const config = await loadProjectsConfig(locttDir);
    expect(config.projects.find(p => p.id === first)?.prefix).toBe("T-");
    const tasks = await loadAllTasks(locttDir);
    expect(tasks.every(t => !t.frontmatter.key.startsWith("API-1"))).toBe(true);
  });

  it("treats setting a project's own prefix as a no-op", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(2, project);

    const result = await setProjectPrefix(locttDir, project, "T-");

    expect(result.renamed).toBe(0);
    const tasks = await loadAllTasks(locttDir);
    // No spurious key_history entry from renaming a task to itself.
    expect(tasks.every(t => t.frontmatter.key_history === undefined)).toBe(true);
  });

  it("rejects an unknown project", async () => {
    await expect(setProjectPrefix(locttDir, "nope", "WEB-")).rejects.toThrow(
      ProjectError,
    );
  });

  it("clears the sentinel when it finishes", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(1, project);
    await setProjectPrefix(locttDir, project, "WEB-");

    // A leftover sentinel would make every later command try to "finish"
    // a rename that already completed.
    expect(await readPrefixRenameState(locttDir)).toBeUndefined();
  });
});

describe("completeInterruptedPrefixRename", () => {
  it("finishes tasks left on the old prefix", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(3, project);

    // Simulate a crash after the sentinel was written but before any
    // task was rewritten: the state lock is released on process exit, so
    // only the sentinel survives to say a rename was in flight.
    await writeYamlAtomically(getPrefixRenameStatePath(locttDir), {
      project_id: project,
      from: "T-",
      to: "WEB-",
      started_at: new Date().toISOString(),
    });

    const result = await completeInterruptedPrefixRename(locttDir);

    expect(result?.renamed).toBe(3);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks.every(t => t.frontmatter.key.startsWith("WEB-"))).toBe(true);
    // Config and state are reapplied, not assumed to have landed.
    const config = await loadProjectsConfig(locttDir);
    expect(config.projects.find(p => p.id === project)?.prefix).toBe("WEB-");
    expect(await readPrefixRenameState(locttDir)).toBeUndefined();
  });

  it("is idempotent — a task already renamed is not renamed twice", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(2, project);
    await setProjectPrefix(locttDir, project, "WEB-");

    // Re-plant the sentinel as though the previous run died just before
    // clearing it. Everything is already done.
    await writeYamlAtomically(getPrefixRenameStatePath(locttDir), {
      project_id: project,
      from: "T-",
      to: "WEB-",
      started_at: new Date().toISOString(),
    });

    const result = await completeInterruptedPrefixRename(locttDir);

    expect(result?.renamed).toBe(0);
    const tasks = await loadAllTasks(locttDir);
    // Exactly one history entry each — a second append would corrupt the
    // trail that makes old keys resolvable.
    for (const t of tasks) {
      // One entry each: a second append would corrupt the trail that
      // makes old keys resolvable.
      expect(t.frontmatter.key_history).toHaveLength(1);
      expect(t.frontmatter.key_history?.[0]).toMatch(/^T-\d+$/);
    }
  });

  it("returns undefined when no rename is pending", async () => {
    expect(await completeInterruptedPrefixRename(locttDir)).toBeUndefined();
  });

  it("reports a rename it could not finish, instead of throwing", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(1, project);
    await writeYamlAtomically(getPrefixRenameStatePath(locttDir), {
      project_id: project,
      from: "T-",
      to: "WEB-",
      started_at: new Date().toISOString(),
    });
    // Corrupt projects.yaml so recovery cannot complete. Every surface
    // calls this on the way in, so a throw here would fail every
    // command against the tracker — including the ones that diagnose it.
    await writeFile(getProjectsConfigPath(locttDir), "projects: [oh no\n");

    const { recovered, error } = await recoverInterruptedPrefixRename(locttDir);

    expect(recovered).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    // Sentinel survives: dropping it would lose the only record of what
    // the half-finished rename was trying to do.
    expect(
      await readFile(getPrefixRenameStatePath(locttDir), "utf-8"),
    ).toContain("WEB-");
  });

  it("reports the rename it finished so a surface can say so", async () => {
    const project = await resolveProjectIdForUser(locttDir);
    await seed(2, project);
    await writeYamlAtomically(getPrefixRenameStatePath(locttDir), {
      project_id: project,
      from: "T-",
      to: "WEB-",
      started_at: new Date().toISOString(),
    });

    const { recovered, error } = await recoverInterruptedPrefixRename(locttDir);

    expect(error).toBeUndefined();
    expect(recovered?.renamed).toBe(2);
    expect(recovered?.to).toBe("WEB-");
  });

  it("stays quiet when there is nothing to recover", async () => {
    const { recovered, error } = await recoverInterruptedPrefixRename(locttDir);
    // Both undefined: this runs before every command, so anything else
    // would make surfaces announce a repair that never happened.
    expect(recovered).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it("clears a sentinel whose project no longer exists", async () => {
    await writeYamlAtomically(getPrefixRenameStatePath(locttDir), {
      project_id: "deleted-project",
      from: "T-",
      to: "WEB-",
      started_at: new Date().toISOString(),
    });

    // Leaving it would block every future command on a rename that can
    // never mean anything again.
    expect(await completeInterruptedPrefixRename(locttDir)).toBeUndefined();
    expect(await readPrefixRenameState(locttDir)).toBeUndefined();
  });
});
