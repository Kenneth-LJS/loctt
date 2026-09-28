/**
 * K152 / B47, as amended by K153: add/remove over many tasks as one
 * operation, partial like bulk set (DEG-C8), one bulk_op_id.
 *
 * @verifies TSK-C16
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadArchivedGuardConfigs } from "../config/archived-guard.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { initLoctt } from "../init/init.js";
import { createLabel } from "../labels/manage.js";
import { getTaskFilePath, resolveLocttDir } from "../paths/index.js";
import { withStateLock } from "../state/lock.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "./create.js";
import { readHistory } from "./history.js";
import { readTask } from "./io.js";
import { bulkEditTaskFields, UnknownFieldValueError } from "./list-edit.js";

describe("bulkEditTaskFields (K152, K153)", () => {
  let root: string;
  let locttDir: string;
  let tasks: Task[];
  let bug: string;
  let infra: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-bulk-list-edit-"));
    await initLoctt(root, { prefix: "T", docs: false, timezone: "UTC" });
    locttDir = resolveLocttDir(root);
    bug = (await createLabel(locttDir, { name: "bug" })).id;
    infra = (await createLabel(locttDir, { name: "infra" })).id;
    const workflowConfig = await loadWorkflowConfig(locttDir);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);
    tasks = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const project = Object.keys(state.keys)[0] as string;
      const out: Task[] = [];
      for (const [title, labels] of [["one", [bug]], ["two", []], ["three", [bug, infra]]] as const) {
        out.push(await createTask({
          locttDir, state, workflowConfig, archivedGuard,
          options: { project, title, labels: [...labels] },
        }));
      }
      await saveState(locttDir, state);
      return out;
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const keys = (): string[] => tasks.map(t => t.frontmatter.key);
  const labelsOf = async (i: number): Promise<unknown> =>
    (await readTask(locttDir, (tasks[i] as Task).frontmatter.id)).frontmatter.labels;
  const labelsFile = (): Promise<string> => readFile(join(locttDir, "config", "labels.yaml"), "utf-8");

  it("adds to each task's own list, reports the no-op task, and stamps one bulk_op_id", async () => {
    const r = await bulkEditTaskFields({ locttDir, taskRefs: keys(), lists: { labels: { add: ["infra"] } } });
    expect(await labelsOf(0)).toEqual([bug, infra]);
    expect(await labelsOf(1)).toEqual([infra]);
    expect(await labelsOf(2)).toEqual([bug, infra]);
    expect(r.unchanged).toEqual([(tasks[2] as Task).frontmatter.id]);
    expect(r.succeeded).toHaveLength(3);
    for (const i of [0, 1]) {
      const h = await readHistory(locttDir, (tasks[i] as Task).frontmatter.id);
      const added = h.filter(e => e.kind === "label_added" && e.after === infra);
      expect(added).toHaveLength(1);
      expect(added[0]?.bulk_op_id).toBe(r.bulk_op_id);
    }
  });

  it("removes and adds in one edit", async () => {
    await bulkEditTaskFields({ locttDir, taskRefs: keys(), lists: { labels: { add: ["infra"], remove: ["bug"] } } });
    for (const i of [0, 1, 2]) expect(await labelsOf(i)).toEqual([infra]);
  });

  // K153 superseded the two tests that stood here: they asserted K152's
  // all-or-nothing rule (one failing task refused the whole edit and
  // nothing was written). Ken ruled bulk add/remove follows bulk set:
  // the failing task is reported and the rest still change.
  it("changes every task it can and reports the one that would fail", async () => {
    // T-2's labels are hand-broken into a string: adding to it would
    // replace what the file holds, so that task alone refuses.
    const file = getTaskFilePath(locttDir, (tasks[1] as Task).frontmatter.id);
    const raw = await readFile(file, "utf-8");
    await writeFile(file, /^labels:/m.test(raw)
      ? raw.replace(/^labels:.*(\n\s+-.*)*$/m, "labels: not-a-list")
      : raw.replace(/^title: two$/m, "title: two\nlabels: not-a-list"), "utf-8");

    const r = await bulkEditTaskFields({
      locttDir, taskRefs: keys(), lists: { labels: { add: ["brand-new"] } }, createMissing: true,
    });

    expect(r.failed.map(f => f.taskId)).toEqual(["T-2"]);
    expect(r.failed[0]?.error).toContain("can't be read as a list");
    const created = r.created[0]?.id as string;
    expect(await labelsOf(0)).toEqual([bug, created]);
    expect(await labelsOf(2)).toEqual([bug, infra, created]);
    expect(r.succeeded).toHaveLength(2);
  });

  it("reports a ref that does not exist as not found and changes the others", async () => {
    const r = await bulkEditTaskFields({
      locttDir, taskRefs: ["T-1", "T-99"], lists: { labels: { add: ["infra"] } },
    });
    expect(r.failed).toEqual([{ taskId: "T-99", error: "task not found" }]);
    expect(await labelsOf(0)).toEqual([bug, infra]);
  });

  it("throws an unknown value as itself, about the command, and writes nothing", async () => {
    const err = await bulkEditTaskFields({
      locttDir, taskRefs: keys(), lists: { labels: { add: ["nope"] } },
    }).then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownFieldValueError);
    expect((err as UnknownFieldValueError).creatable).toBe(true);
    expect(await labelsOf(1)).toEqual([]);
  });

  it("creates a missing label once and adds it everywhere", async () => {
    const r = await bulkEditTaskFields({
      locttDir, taskRefs: keys(), lists: { labels: { add: ["urgent"] } }, createMissing: true,
    });
    expect(r.created).toHaveLength(1);
    const created = r.created[0]?.id as string;
    for (const i of [0, 1, 2]) expect(await labelsOf(i)).toContain(created);
    expect((await labelsFile()).match(/name: urgent/g)).toHaveLength(1);
  });
});
