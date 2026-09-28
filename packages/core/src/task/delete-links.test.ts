import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkflowConfig } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { initLoctt } from "../init/init.js";
import { getTaskDir, resolveLocttDir } from "../paths/index.js";
import { loadKeyIndex, loadState, saveState, withStateLock } from "../state/index.js";
import { bulkDelete } from "./bulk.js";
import { createTask } from "./create.js";
import { readHistory } from "./history.js";
import { readTask } from "./io.js";
import { deleteTask } from "./lifecycle.js";
import { lookupTask } from "./lookup.js";
import { linkTask } from "./relationships.js";

/**
 * K147 (G4): a delete removes the other side of every link, recorded in
 * the partner's history. G5/G6: a delete drops the task's keys from the
 * on-disk key index, and a create adds its key when an index exists.
 */
let root: string;
let locttDir: string;
let projectId: string;
let workflowConfig: WorkflowConfig;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-delete-links-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  projectId = (await loadProjectsConfig(locttDir)).projects[0]?.id as string;
  workflowConfig = await loadWorkflowConfig(locttDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(title: string): Promise<{ id: string; key: string }> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const t = await createTask({ locttDir, state, options: { project: projectId, title } });
    await saveState(locttDir, state);
    return { id: t.frontmatter.id, key: t.frontmatter.key };
  });
}

async function link(from: string, type: string, to: string): Promise<void> {
  await linkTask({ locttDir, taskId: from, type, target: to, workflowConfig });
}

// @verifies REL-C8
describe("delete removes the partners' side of its links (K147)", () => {
  it("deleteTask removes the inverse edge from the partner and logs link_removed there", async () => {
    const a = await seed("A");
    const b = await seed("B");
    const c = await seed("C");
    await link(a.id, "blocks", b.id);
    await link(a.id, "relates_to", c.id);

    await deleteTask(locttDir, a.id, { force: true });

    expect((await readTask(locttDir, b.id)).frontmatter.relationships).toBeUndefined();
    expect((await readTask(locttDir, c.id)).frontmatter.relationships).toBeUndefined();
    const bHistory = await readHistory(locttDir, b.id);
    expect(bHistory.at(-1)).toMatchObject({
      kind: "link_removed",
      meta: { type: "is_blocked_by", target: a.id },
    });
    const cHistory = await readHistory(locttDir, c.id);
    expect(cHistory.at(-1)).toMatchObject({
      kind: "link_removed",
      meta: { type: "relates_to", target: a.id },
    });
  });

  it("keeps the partner's other links", async () => {
    const a = await seed("A");
    const b = await seed("B");
    const c = await seed("C");
    await link(a.id, "blocks", b.id);
    await link(b.id, "blocks", c.id);

    await deleteTask(locttDir, a.id, { force: true });

    expect((await readTask(locttDir, b.id)).frontmatter.relationships)
      .toEqual([{ type: "blocks", target: c.id, rank: "u" }]);
  });

  it("bulkDelete detaches partners outside the batch, with the batch's bulk_op_id, and leaves the batch deleted", async () => {
    const a = await seed("A");
    const b = await seed("B");
    const keep = await seed("Keep");
    await link(a.id, "blocks", b.id);
    await link(a.id, "relates_to", keep.id);

    const result = await bulkDelete({ locttDir, taskRefs: [a.id, b.id] });

    expect(result.succeeded).toEqual([a.id, b.id]);
    // A partner deleted in the same batch is not written back to life.
    expect(existsSync(getTaskDir(locttDir, b.id))).toBe(false);
    expect((await readTask(locttDir, keep.id)).frontmatter.relationships).toBeUndefined();
    expect((await readHistory(locttDir, keep.id)).at(-1)).toMatchObject({
      kind: "link_removed",
      meta: { type: "relates_to", target: a.id },
      bulk_op_id: result.bulk_op_id,
    });
  });
});

// @verifies TSK-C13
describe("the on-disk key index follows create and delete (G5, G6)", () => {
  it("create adds the new key to an existing index", async () => {
    const a = await seed("A");
    await lookupTask(locttDir, a.key); // writes the index
    expect(await loadKeyIndex(locttDir)).toBeDefined();

    const b = await seed("B");

    expect((await loadKeyIndex(locttDir))?.entries[b.key]).toBe(b.id);
  });

  it("create does not write an index when none exists", async () => {
    await seed("A");
    expect(await loadKeyIndex(locttDir)).toBeUndefined();
  });

  it("deleteTask and bulkDelete drop the deleted tasks' keys, current and former", async () => {
    const a = await seed("A");
    const b = await seed("B");
    const keep = await seed("Keep");
    await lookupTask(locttDir, a.key);
    // A former key, as a move leaves behind.
    const { saveKeyIndex } = await import("../state/index.js");
    const index = await loadKeyIndex(locttDir);
    await saveKeyIndex(locttDir, { entries: { ...index?.entries, "OLD-1": a.id } });

    await deleteTask(locttDir, a.id, { force: true });
    let entries = (await loadKeyIndex(locttDir))?.entries ?? {};
    expect(entries[a.key]).toBeUndefined();
    expect(entries["OLD-1"]).toBeUndefined();
    expect(entries[b.key]).toBe(b.id);

    await bulkDelete({ locttDir, taskRefs: [b.key] });
    entries = (await loadKeyIndex(locttDir))?.entries ?? {};
    expect(entries[b.key]).toBeUndefined();
    expect(entries[keep.key]).toBe(keep.id);
  });
});
