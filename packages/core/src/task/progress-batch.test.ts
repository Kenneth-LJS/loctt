import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "./create.js";
import { milestoneProgress } from "./progress.js";
import { setFields } from "./update.js";

describe("milestoneProgress", () => {
  let root: string;
  let locttDir: string;
  let projectId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-progress-"));
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
    projectId = (await loadProjectsConfig(locttDir)).projects[0]!.id;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Registers a milestone by name and returns its id.
   *
   * `setFields` resolves a milestone reference to its id and refuses an
   * unknown one, so these fixtures can no longer invent `"m1"`. They
   * used to write the raw name straight to frontmatter — the state
   * MSL-C1 was closed to prevent, where progress reads 0/0 because the
   * lookup is by id.
   */
  async function milestone(name: string): Promise<string> {
    const { createMilestone } = await import("../milestones/manage.js");
    return (await createMilestone(locttDir, { name })).id;
  }

  async function mk(title: string, fields: Record<string, unknown>): Promise<string> {
    const id = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const t = await createTask({ locttDir, state, options: { project: projectId, title } });
      await saveState(locttDir, state);
      return t.frontmatter.id;
    });
    const changes = Object.entries(fields).map(([field, value]) => ({ field, value }));
    if (changes.length > 0) {
      await setFields({ locttDir, taskId: id, changes });
    }
    return id;
  }

  it("groups tasks by milestone in one scan", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    const m2 = await milestone("m2");
    await mk("a", { milestone: m1, status: "done" });
    await mk("b", { milestone: m1 });
    await mk("c", { milestone: m2, status: "done" });

    const p = await milestoneProgress(locttDir, [m1, m2], wf);
    expect(p[m1]).toMatchObject({ done: 1, total: 2 });
    expect(p[m2]).toMatchObject({ done: 1, total: 1 });
  });

  it("returns a zeroed entry for a milestone with no tasks", async () => {
    // Present rather than absent, so a caller can render every
    // milestone without checking.
    const wf = await loadWorkflowConfig(locttDir);
    const p = await milestoneProgress(locttDir, ["empty"], wf);
    expect(p["empty"]).toEqual({ done: 0, total: 0, discarded: 0, fraction: 0 });
  });

  it("ignores tasks belonging to another milestone", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    const other = await milestone("other");
    await mk("a", { milestone: m1, status: "done" });
    await mk("b", { milestone: other, status: "done" });
    expect((await milestoneProgress(locttDir, [m1], wf))[m1]?.total).toBe(1);
  });

  it("excludes archived tasks by default and includes them on request", async () => {
    // Must match countTasksByReference: the two numbers sit side by
    // side in Settings and cannot disagree about what they counted.
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    await mk("live", { milestone: m1 });
    const gone = await mk("gone", { milestone: m1 });
    // `archived` is not settable via setFields — it has its own API.
    const { bulkArchive } = await import("./bulk.js");
    await bulkArchive({ locttDir, taskRefs: [gone], archive: true });

    expect((await milestoneProgress(locttDir, [m1], wf))[m1]?.total).toBe(1);
    const withArchived = await milestoneProgress(locttDir, [m1], wf, { includeArchived: true });
    expect(withArchived[m1]?.total).toBe(2);
  });

  it("excludes discarded from the denominator end to end", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    await mk("shipped", { milestone: m1, status: "done" });
    await mk("dropped", { milestone: m1, status: "wont_do" });
    const p = (await milestoneProgress(locttDir, [m1], wf))[m1];
    expect(p).toMatchObject({ done: 1, total: 1, discarded: 1, fraction: 1 });
  });
});
