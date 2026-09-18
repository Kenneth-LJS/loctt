import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { bulkSetFields } from "./bulk.js";
import { createTask } from "./create.js";
import { readHistory } from "./history.js";
import { readTask } from "./io.js";
import { setFields } from "./update.js";

/**
 * `bulkSetFields` and `setFields` must agree on what may be written and
 * what a write produces.
 *
 * They used to be two implementations of the same logic, and they had
 * already drifted: bulk silently accepted unsetting a custom field that
 * was not set, and — worse — let a caller overwrite `updated_at`, which
 * the single-task path refuses because it is stamped automatically.
 *
 * bulk now delegates to the same locked primitive, so these assert the
 * shared contract rather than two parallel ones.
 */
describe("bulkSetFields / setFields parity", () => {
  let root: string;
  let locttDir: string;
  let projectId: string;

  async function mkTask(title: string): Promise<string> {
    return withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const t = await createTask({ locttDir, state, options: { project: projectId, title } });
      await saveState(locttDir, state);
      return t.frontmatter.id;
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-bulk-parity-"));
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
    projectId = (await loadProjectsConfig(locttDir)).projects[0]!.id;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("both reject the same change sets", () => {
    it.each([
      ["an empty change set", []],
      ["a duplicate field", [{ field: "status", value: "done" }, { field: "status", value: "backlog" }]],
      ["an immutable field", [{ field: "id", value: "x" }]],
      ["an auto-managed field", [{ field: "completed_date", value: "2026-01-01" }]],
      ["a direct updated_at write", [{ field: "updated_at", value: "1999-01-01T00:00:00Z" }]],
      ["unsetting title", [{ field: "title", value: undefined }]],
    ])("%s", async (_label, changes) => {
      const id = await mkTask("subject");
      await expect(setFields({ locttDir, taskId: id, changes })).rejects.toThrow();
      await expect(bulkSetFields({ locttDir, taskRefs: [id], changes })).rejects.toThrow();
    });

    it("rejects the batch rather than recording a per-task failure", async () => {
      // A bad field name is a caller error affecting every task
      // equally, not a per-task condition — so it must not be reported
      // as "3 of 4 succeeded".
      const id = await mkTask("subject");
      await expect(
        bulkSetFields({ locttDir, taskRefs: [id], changes: [{ field: "id", value: "x" }] }),
      ).rejects.toThrow();
      // Nothing was written.
      expect((await readTask(locttDir, id)).frontmatter.title).toBe("subject");
    });
  });

  describe("both produce the same result", () => {
    it("writes the same frontmatter for the same change", async () => {
      const a = await mkTask("one");
      const b = await mkTask("two");
      const workflowConfig = await loadWorkflowConfig(locttDir);
      const changes = [{ field: "status", value: "in_progress" }, { field: "priority", value: "high" }];

      await setFields({ locttDir, taskId: a, changes, workflowConfig });
      await bulkSetFields({ locttDir, taskRefs: [b], changes, workflowConfig });

      const fa = (await readTask(locttDir, a)).frontmatter;
      const fb = (await readTask(locttDir, b)).frontmatter;
      expect(fb.status).toBe(fa.status);
      expect(fb.priority).toBe(fa.priority);
      // status_updated_at is stamped on both paths.
      expect(fb.status_updated_at).toBeTruthy();
    });

    it("unsetting a custom field that is not set fails on both", async () => {
      // Bulk used to skip this silently while setFields threw.
      const id = await mkTask("subject");
      await expect(
        setFields({ locttDir, taskId: id, changes: [{ field: "nope", value: undefined }] }),
      ).rejects.toThrow();
      const r = await bulkSetFields({
        locttDir, taskRefs: [id], changes: [{ field: "nope", value: undefined }],
      });
      expect(r.failed).toHaveLength(1);
      expect(r.succeeded).toEqual([]);
    });

    it("stamps completed_date when moving into a completed status", async () => {
      const id = await mkTask("subject");
      const workflowConfig = await loadWorkflowConfig(locttDir);
      await bulkSetFields({
        locttDir, taskRefs: [id],
        changes: [{ field: "status", value: "done" }],
        workflowConfig,
      });
      expect((await readTask(locttDir, id)).frontmatter.completed_date).toBeTruthy();
    });

    it("clears completed_date when moving back out of one", async () => {
      const id = await mkTask("subject");
      const workflowConfig = await loadWorkflowConfig(locttDir);
      await bulkSetFields({
        locttDir, taskRefs: [id], changes: [{ field: "status", value: "done" }], workflowConfig,
      });
      await bulkSetFields({
        locttDir, taskRefs: [id], changes: [{ field: "status", value: "backlog" }], workflowConfig,
      });
      expect((await readTask(locttDir, id)).frontmatter.completed_date).toBeUndefined();
    });
  });

  describe("bulk-only behaviour is preserved", () => {
    it("stamps one bulk_op_id on every history entry it produces", async () => {
      const a = await mkTask("one");
      const b = await mkTask("two");
      const workflowConfig = await loadWorkflowConfig(locttDir);
      const r = await bulkSetFields({
        locttDir, taskRefs: [a, b],
        changes: [{ field: "status", value: "in_progress" }],
        workflowConfig,
      });

      for (const id of [a, b]) {
        const entries = await readHistory(locttDir, id);
        const stamped = entries.filter(e => e.bulk_op_id === r.bulk_op_id);
        expect(stamped.length, `task ${id} should carry the bulk id`).toBeGreaterThan(0);
      }
    });

    it("a single-task write carries no bulk_op_id", async () => {
      const id = await mkTask("subject");
      const workflowConfig = await loadWorkflowConfig(locttDir);
      await setFields({
        locttDir, taskId: id, changes: [{ field: "status", value: "done" }], workflowConfig,
      });
      const entries = await readHistory(locttDir, id);
      expect(entries.every(e => e.bulk_op_id === undefined)).toBe(true);
    });

    it("shares one timestamp across the batch", async () => {
      // A batch straddling midnight must not split across two days.
      const a = await mkTask("one");
      const b = await mkTask("two");
      const workflowConfig = await loadWorkflowConfig(locttDir);
      await bulkSetFields({
        locttDir, taskRefs: [a, b],
        changes: [{ field: "status", value: "in_progress" }],
        workflowConfig,
      });
      const fa = (await readTask(locttDir, a)).frontmatter;
      const fb = (await readTask(locttDir, b)).frontmatter;
      expect(fb.updated_at).toBe(fa.updated_at);
      expect(fb.status_updated_at).toBe(fa.status_updated_at);
    });

    it("records a per-task failure without aborting the rest", async () => {
      const a = await mkTask("one");
      const workflowConfig = await loadWorkflowConfig(locttDir);
      const r = await bulkSetFields({
        locttDir, taskRefs: [a, "T-404"],
        changes: [{ field: "status", value: "done" }],
        workflowConfig,
      });
      expect(r.succeeded).toEqual([a]);
      expect(r.failed).toHaveLength(1);
      expect((await readTask(locttDir, a)).frontmatter.status).toBe("done");
    });
  });
});
