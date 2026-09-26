import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { getTaskFilePath } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "./create.js";
import { isProgressUnavailable, milestoneProgress, milestoneProgressDetailed,type MilestoneProgressResult } from "./progress.js";
import { setFields } from "./update.js";

/**
 * Narrows a per-milestone result to its success arm for assertions.
 * Fails the test loudly if the milestone came back unavailable, so a
 * regression that blanks a healthy milestone's numbers surfaces here
 * rather than as a confusing `undefined` deref.
 */
function counted(result: MilestoneProgressResult | undefined) {
  expect(result).toBeDefined();
  if (isProgressUnavailable(result)) {
    throw new Error(`expected computed progress, got unavailable: ${result.reason}`);
  }
  return result!;
}

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
    expect(counted(p[m1])).toMatchObject({ done: 1, total: 2 });
    expect(counted(p[m2])).toMatchObject({ done: 1, total: 1 });
  });

  it("returns a zeroed entry for a milestone with no tasks", async () => {
    // Present rather than absent, so a caller can render every
    // milestone without checking.
    const wf = await loadWorkflowConfig(locttDir);
    const p = await milestoneProgress(locttDir, ["empty"], wf);
    expect(p["empty"]).toEqual({ done: 0, active: 0, total: 0, discarded: 0, fraction: 0 });
  });

  it("ignores tasks belonging to another milestone", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    const other = await milestone("other");
    await mk("a", { milestone: m1, status: "done" });
    await mk("b", { milestone: other, status: "done" });
    expect(counted((await milestoneProgress(locttDir, [m1], wf))[m1]).total).toBe(1);
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

    expect(counted((await milestoneProgress(locttDir, [m1], wf))[m1]).total).toBe(1);
    const withArchived = await milestoneProgress(locttDir, [m1], wf, { includeArchived: true });
    expect(counted(withArchived[m1]).total).toBe(2);
  });

  it("excludes discarded from the denominator end to end", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    await mk("shipped", { milestone: m1, status: "done" });
    await mk("dropped", { milestone: m1, status: "wont_do" });
    const p = counted((await milestoneProgress(locttDir, [m1], wf))[m1]);
    expect(p).toMatchObject({ done: 1, total: 1, discarded: 1, fraction: 1 });
  });

  it("marks a milestone unavailable when a member is unreadable but attributable (MSL-35)", async () => {
    // MSL-35: an object-fatal member whose `milestone:` line survives is
    // ATTRIBUTED — the milestone it belongs to reads unavailable (its
    // numbers cannot honestly be `done / total` with a member missing),
    // and it does NOT ride in the tracker-level `unreadable` list. This
    // replaces the old ceiling test, which asserted the milestone kept
    // `{done:1,total:1}` while the member vanished into a global list —
    // an all-or-nothing behaviour MSL-35's last bullet ruled out. That
    // green expectation was encoding the bug (CLAUDE.md).
    // @verifies MSL-35
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    await mk("readable", { milestone: m1, status: "done" });
    const broken = await mk("broken", { milestone: m1 });
    // Object-fatal via a wrong-typed `id` (FATAL_IDENTITY_FIELDS), yet the
    // frontmatter still splits and the `milestone:` line is intact — so
    // the reference is recoverable and the failure is attributable.
    await writeFile(
      getTaskFilePath(locttDir, broken),
      `---\nid:\n  broken: mapping\nkey: T-9\nmilestone: ${m1}\n---\nbody\n`,
      "utf8",
    );

    const report = await milestoneProgressDetailed(locttDir, [m1], wf);
    // The milestone with the unreadable member is unavailable, not a
    // plausible-but-short `1 / 1`.
    expect(isProgressUnavailable(report.progress[m1])).toBe(true);
    // Attributed, so it is NOT double-reported at the tracker level.
    expect(report.unreadable).toHaveLength(0);
    // …which makes the per-row reason the only place the broken file is
    // named: it must carry the path, and exactly once (A350).
    const row = report.progress[m1];
    const reason = isProgressUnavailable(row) ? row.reason : "";
    const path = getTaskFilePath(locttDir, broken);
    expect(reason.startsWith(`${path}: `)).toBe(true);
    expect(reason.split(path)).toHaveLength(2);
  });

  it("fails only the affected milestone; siblings keep their real numbers (MSL-35)", async () => {
    // The case the documented ceiling blocked: one milestone's progress
    // computation fails while the OTHERS keep rendering their own. Under
    // the old single-scan design this could not happen — every
    // milestone's numbers succeeded or failed together.
    // @verifies MSL-35
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    const m2 = await milestone("m2");
    const m3 = await milestone("m3");
    await mk("a-done", { milestone: m1, status: "done" });
    const bad = await mk("a-broken", { milestone: m1 });
    await mk("b-done", { milestone: m2, status: "done" });
    await mk("b-open", { milestone: m2 });
    await mk("c-done", { milestone: m3, status: "done" });
    // A member of m1 is object-fatal but attributable to m1.
    await writeFile(
      getTaskFilePath(locttDir, bad),
      `---\nid:\n  broken: mapping\nkey: T-8\nmilestone: ${m1}\n---\nbody\n`,
      "utf8",
    );

    const report = await milestoneProgressDetailed(locttDir, [m1, m2, m3], wf);
    // m1 fails per-row…
    expect(isProgressUnavailable(report.progress[m1])).toBe(true);
    // …while m2 and m3 report their real numbers, untouched.
    expect(counted(report.progress[m2])).toMatchObject({ done: 1, total: 2 });
    expect(counted(report.progress[m3])).toMatchObject({ done: 1, total: 1 });
  });

  it("reports an un-attributable unreadable task at the tracker level (K28)", async () => {
    // A member whose frontmatter delimiters are themselves destroyed
    // cannot be attributed to any milestone — its `milestone:` line is
    // unrecoverable. It stays in the tracker-level `unreadable` list
    // (the documented default), the readable milestone counts honestly,
    // and nothing is silently dropped (P-5).
    // @verifies DEG-25
    const wf = await loadWorkflowConfig(locttDir);
    const m1 = await milestone("m1");
    await mk("readable", { milestone: m1, status: "done" });
    const broken = await mk("broken", { milestone: m1 });
    // No closing `---`: `splitTaskFile` throws, so the reference line
    // cannot be recovered and the task is un-attributable.
    await writeFile(getTaskFilePath(locttDir, broken), "---\n: : not: valid: yaml\n:::\n", "utf8");

    const report = await milestoneProgressDetailed(locttDir, [m1], wf);
    // The readable corpus is counted honestly: one done task, one total.
    expect(counted(report.progress[m1])).toMatchObject({ done: 1, total: 1 });
    // The unreadable member is REPORTED, not skipped — the file is named.
    expect(report.unreadable).toHaveLength(1);
    expect(report.unreadable[0]?.id).toBe(broken);
    expect(report.unreadable[0]?.path).toBe(getTaskFilePath(locttDir, broken));
    expect(report.unreadable[0]?.reason).toBeTruthy();
  });
});
