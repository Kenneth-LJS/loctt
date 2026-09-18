import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { getTaskFilePath, resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { seedLabels, seedMilestone, seedSprint, seedUser } from "../test-support/entities.js";
import { createTask } from "./create.js";
import { duplicateTask } from "./duplicate.js";
import { readHistory } from "./history.js";
import { lookupTask } from "./lookup.js";
import { linkTask } from "./relationships.js";

let root: string;
let locttDir: string;
let projectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-duplicate-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const cfg = await loadProjectsConfig(locttDir);
  projectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(opts: Parameters<typeof createTask>[0]["options"]): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const t = await createTask({ locttDir, state, options: opts });
    await saveState(locttDir, state);
    return t.frontmatter.id;
  });
}

async function dup(srcRef: string, overrides?: Parameters<typeof duplicateTask>[0]["overrides"]): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const { task } = await duplicateTask({ locttDir, state, sourceRef: srcRef, ...(overrides !== undefined ? { overrides } : {}) });
    await saveState(locttDir, state);
    return task.frontmatter.id;
  });
}

describe("duplicateTask — basics", () => {
  it("copies field values from the source to the duplicate", async () => {
    // Every entity reference has to resolve: frontmatter stores ULIDs
    // (P-2) and the write paths refuse a reference to something that
    // was never created. This test is about copy semantics, so the
    // entities are setup rather than the subject.
    const [a, b] = await seedLabels(locttDir, "a", "b");
    const u1 = await seedUser(locttDir, "u1");
    const u2 = await seedUser(locttDir, "u2");
    const v1 = await seedMilestone(locttDir, "v1");
    const s12 = await seedSprint(locttDir, "s12");
    const srcId = await seed({
      project: projectId, title: "Original", status: "backlog", priority: "high",
      task_type: "task", labels: [a, b], assignee: u1, reporter: u2,
      start_date: "2026-05-01", due_date: "2026-05-15", estimate: "5",
      milestone: v1, sprint: s12,
      fields: { impact: "medium" },
      body: "Hello world\n",
    });
    const copyId = await dup(srcId);
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.frontmatter.title).toBe("Original (copy)");
    expect(copy.frontmatter.status).toBe("backlog");
    expect(copy.frontmatter.priority).toBe("high");
    expect(copy.frontmatter.task_type).toBe("task");
    expect(copy.frontmatter.labels).toEqual([a, b]);
    expect(copy.frontmatter.assignee).toBe(u1);
    expect(copy.frontmatter.reporter).toBe(u2);
    expect(copy.frontmatter.start_date).toBe("2026-05-01");
    expect(copy.frontmatter.due_date).toBe("2026-05-15");
    expect(copy.frontmatter.estimate).toBe("5");
    expect(copy.frontmatter.milestone).toBe(v1);
    expect(copy.frontmatter.sprint).toBe(s12);
    expect(copy.frontmatter.fields).toEqual({ impact: "medium" });
    expect(copy.body).toBe("Hello world\n");
  });

  it("allocates a fresh id and key (does not share with the source)", async () => {
    const srcId = await seed({ project: projectId, title: "Original" });
    const src = await lookupTask(locttDir, srcId);
    const copyId = await dup(srcId);
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.frontmatter.id).not.toBe(src.frontmatter.id);
    expect(copy.frontmatter.key).not.toBe(src.frontmatter.key);
    // Both keys share the same prefix (same project).
    expect(copy.frontmatter.key.split("-")[0]).toBe(src.frontmatter.key.split("-")[0]);
  });

  it("does not copy relationships", async () => {
    const a = await seed({ project: projectId, title: "A" });
    const b = await seed({ project: projectId, title: "B" });
    // linkTask takes its own state lock internally, so call it directly.
    await linkTask({ locttDir, taskId: a, type: "blocks", target: b });
    const copyId = await dup(a);
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.frontmatter.relationships).toBeUndefined();
  });

  it("does not copy archived state — copy starts active", async () => {
    const srcId = await seed({ project: projectId, title: "Original" });
    const { archiveTask } = await import("./lifecycle.js");
    await archiveTask(locttDir, srcId);
    const copyId = await dup(srcId);
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.frontmatter.archived).toBeUndefined();
  });

  it("source task is untouched (no history mutation)", async () => {
    const srcId = await seed({ project: projectId, title: "Original" });
    const before = await readHistory(locttDir, srcId);
    await dup(srcId);
    const after = await readHistory(locttDir, srcId);
    expect(after.length).toBe(before.length);
  });

  it("the copy gets a fresh `created` history entry", async () => {
    const srcId = await seed({ project: projectId, title: "Original" });
    const copyId = await dup(srcId);
    const history = await readHistory(locttDir, copyId);
    expect(history.length).toBe(1);
    expect(history[0]?.kind).toBe("created");
  });
});

describe("duplicateTask — overrides", () => {
  it("override title replaces the auto-suffixed title", async () => {
    const srcId = await seed({ project: projectId, title: "Original" });
    const copyId = await dup(srcId, { title: "Custom" });
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.frontmatter.title).toBe("Custom");
  });

  it("override null clears a scalar field on the copy", async () => {
    const u1 = await seedUser(locttDir, "u1");
    const v1 = await seedMilestone(locttDir, "v1");
    const srcId = await seed({ project: projectId, title: "T", assignee: u1, milestone: v1 });
    const copyId = await dup(srcId, { assignee: null, milestone: null });
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.frontmatter.assignee).toBeUndefined();
    expect(copy.frontmatter.milestone).toBeUndefined();
  });

  it("override labels replaces the entire array", async () => {
    const [a, b, c] = await seedLabels(locttDir, "a", "b", "c");
    const srcId = await seed({ project: projectId, title: "T", labels: [a, b] });
    const copyId = await dup(srcId, { labels: [c] });
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.frontmatter.labels).toEqual([c]);
  });

  it("override body replaces the source body", async () => {
    const srcId = await seed({ project: projectId, title: "T", body: "original\n" });
    const copyId = await dup(srcId, { body: "rewritten\n" });
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.body).toBe("rewritten\n");
  });

  it("override project allocates from the target project's prefix", async () => {
    const { createProject } = await import("../projects/manage.js");
    const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT" });
    const srcId = await seed({ project: projectId, title: "T" });
    const copyId = await dup(srcId, { project: alt.id });
    const copy = await lookupTask(locttDir, copyId);
    expect(copy.frontmatter.project).toBe(alt.id);
    expect(copy.frontmatter.key.startsWith("ALT-")).toBe(true);
  });
});

describe("duplicateTask — labels deep-copy", () => {
  it("the copy's labels array is independent from the source's", async () => {
    const [a, b] = await seedLabels(locttDir, "a", "b");
    const srcId = await seed({ project: projectId, title: "T", labels: [a] });
    const copyId = await dup(srcId);
    // Mutate the copy's labels via setField — source must not change.
    const { setField } = await import("./update.js");
    await setField({ locttDir, taskId: copyId, field: "labels", value: [a, b] });
    const src = await lookupTask(locttDir, srcId);
    const copy = await lookupTask(locttDir, copyId);
    expect(src.frontmatter.labels).toEqual([a]);
    expect(copy.frontmatter.labels).toEqual([a, b]);
  });
});

describe("duplicateTask — sourceRef resolution", () => {
  it("accepts the source's current key", async () => {
    const srcId = await seed({ project: projectId, title: "T" });
    const src = await lookupTask(locttDir, srcId);
    const copyId = await dup(src.frontmatter.key);
    expect(copyId).not.toBe(srcId);
  });

  it("throws when the source ref doesn't resolve", async () => {
    const state = await loadState(locttDir);
    await expect(
      duplicateTask({ locttDir, state, sourceRef: "NONEXISTENT-9999" }),
    ).rejects.toThrow();
  });
});

/**
 * DUP-H1: a duplicate never copies a raw corrupt value (the field is
 * lifted into health and reads undefined), but it now REPORTS which
 * fields it dropped, so the copy's missing values are explained rather
 * than silently absent.
 *
 * @verifies DUP-H1
 */
describe("duplicateTask — reports dropped corrupt fields (DUP-H1)", () => {
  it("names a corrupt source field in `dropped` and does not copy it", async () => {
    // Create a healthy source, then corrupt its due_date on disk so it
    // loads as a health finding, not frontmatter.
    const src = await createTask({
      locttDir,
      state: await loadState(locttDir),
      options: { title: "Src", project: projectId, due_date: "2026-05-01" },
    });
    const file = getTaskFilePath(locttDir, src.frontmatter.id);
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(file, "utf-8");
    await writeFile(file, raw.replace(/due_date:.*/, "due_date: 42"), "utf-8");

    const state = await loadState(locttDir);
    const { task, dropped } = await duplicateTask({
      locttDir, state, sourceRef: src.frontmatter.id,
    });
    await saveState(locttDir, state);

    // The corrupt field did not come across...
    expect(task.frontmatter.due_date).toBeUndefined();
    // ...and it is named in the report.
    expect(dropped).toContain("due_date");
  });

  it("reports nothing dropped for a fully-healthy source", async () => {
    const src = await createTask({
      locttDir,
      state: await loadState(locttDir),
      options: { title: "Clean", project: projectId, due_date: "2026-05-01" },
    });
    const state = await loadState(locttDir);
    const { dropped } = await duplicateTask({
      locttDir, state, sourceRef: src.frontmatter.id,
    });
    await saveState(locttDir, state);
    expect(dropped).toEqual([]);
  });
});

/**
 * DEG-27 (duplicate half): a duplicate over a corrupt task carries health
 * correctly — a corrupt scalar field is lifted into health and NOT copied
 * (asserted by the DUP-H1 block above), and when `project` itself is corrupt
 * the duplicate REFUSES rather than minting a key under a broken project
 * (§ 13.3). The merge half of DEG-27 is explicitly "cannot be satisfied yet"
 * in the case text (a write path with no test, cross-ref DEG-21), so this
 * covers exactly the buildable half — same precedent as DEG-21, which is
 * tagged despite an unbuildable remainder.
 *
 * @verifies DEG-27
 */
describe("duplicateTask — refuses over a corrupt project (DEG-27)", () => {
  it("refuses when the source's project field is corrupt, naming the cause", async () => {
    // Create a healthy source, then corrupt its `project` on disk so it
    // loads as a health finding rather than a usable project reference.
    const src = await createTask({
      locttDir,
      state: await loadState(locttDir),
      options: { title: "Src", project: projectId },
    });
    const file = getTaskFilePath(locttDir, src.frontmatter.id);
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(file, "utf-8");
    // A wrong-typed project (a number) is lifted into health, so
    // `fm.project` reads undefined and the duplicate cannot allocate a key.
    await writeFile(file, raw.replace(/project:.*/, "project: 42"), "utf-8");

    const state = await loadState(locttDir);
    await expect(
      duplicateTask({ locttDir, state, sourceRef: src.frontmatter.id }),
    ).rejects.toThrow(/project is corrupt/);
  });

  it("allows the duplicate when a --project override is supplied instead", async () => {
    // The refusal is specifically about a missing/broken project with no
    // way to allocate a key — an override provides one, so it succeeds.
    const src = await createTask({
      locttDir,
      state: await loadState(locttDir),
      options: { title: "Src", project: projectId },
    });
    const file = getTaskFilePath(locttDir, src.frontmatter.id);
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(file, "utf-8");
    await writeFile(file, raw.replace(/project:.*/, "project: 42"), "utf-8");

    const state = await loadState(locttDir);
    const { task } = await duplicateTask({
      locttDir, state, sourceRef: src.frontmatter.id,
      overrides: { project: projectId },
    });
    await saveState(locttDir, state);
    expect(task.frontmatter.project).toBe(projectId);
  });
});
