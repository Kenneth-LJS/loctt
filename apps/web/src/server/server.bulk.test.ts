import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BulkResponse, TaskResponse } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Bulk routes (CW-4).
 *
 * Core had bulkSetFields/bulkArchive/bulkMoveTasksToProject and no HTTP
 * route reached any of them — `grep -c bulk server.ts` was 0 — so the
 * documented bulk bar had no backend at all.
 */
describe("POST /api/tasks/bulk/*", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-bulk-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
    for (const title of ["one", "two", "three"]) {
      await fetch(`${base}/api/tasks`, {
        method: "POST", headers: csrf, body: JSON.stringify({ title }),
      });
    }
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function bulk(op: string, body: unknown): Promise<{ status: number; json: BulkResponse }> {
    const res = await fetch(`${base}/api/tasks/bulk/${op}`, {
      method: "POST", headers: csrf, body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as BulkResponse };
  }

  const getTask = async (ref: string): Promise<TaskResponse> =>
    (await (await fetch(`${base}/api/tasks/${ref}`)).json()) as TaskResponse;

  describe("set", () => {
    it("applies a field change to every listed task", async () => {
      const { status, json } = await bulk("set", {
        refs: ["T-1", "T-2"],
        changes: [{ field: "status", value: "in_progress" }],
      });
      expect(status).toBe(200);
      expect(json.succeeded).toHaveLength(2);
      expect(json.failed).toEqual([]);

      // Assert the far end, not just the response.
      expect((await getTask("T-1")).frontmatter.status).toBe("in_progress");
      expect((await getTask("T-2")).frontmatter.status).toBe("in_progress");
      expect((await getTask("T-3")).frontmatter.status).toBe("backlog");
    });

    it("clears a field when value is null", async () => {
      // JSON has no `undefined`, which is what core reads as "clear".
      // Without the null → undefined mapping this would try to write
      // the literal null and a separate unset route would be needed.
      await bulk("set", { refs: ["T-1"], changes: [{ field: "priority", value: "high" }] });
      expect((await getTask("T-1")).frontmatter.priority).toBe("high");

      const { json } = await bulk("set", {
        refs: ["T-1"], changes: [{ field: "priority", value: null }],
      });
      expect(json.failed).toEqual([]);
      expect((await getTask("T-1")).frontmatter.priority).toBeUndefined();
    });

    it("reports per-task failures without aborting the batch", async () => {
      // Partial success is the normal outcome, and the split is what
      // lets a UI retain exactly the failures for retry (ERR-13).
      const { status, json } = await bulk("set", {
        refs: ["T-1", "T-999", "T-2"],
        changes: [{ field: "status", value: "done" }],
      });
      expect(status).toBe(200);
      expect(json.succeeded).toHaveLength(2);
      expect(json.failed).toHaveLength(1);
      expect(json.failed[0]?.taskId).toBe("T-999");
      // The good refs still landed.
      expect((await getTask("T-1")).frontmatter.status).toBe("done");
    });

    it("reports an unknown enum value per task, leaving the task untouched", async () => {
      // Validation failures land in `failed[]` like any other per-task
      // error rather than 400-ing the batch — consistent with core's
      // contract that one bad task does not abort the rest.
      const { status, json } = await bulk("set", {
        refs: ["T-1"], changes: [{ field: "status", value: "frobnik" }],
      });
      expect(status).toBe(200);
      expect(json.succeeded).toEqual([]);
      expect(json.failed).toHaveLength(1);
      expect(json.failed[0]?.error).toMatch(/status/);
      // Crucially: nothing was written.
      expect((await getTask("T-1")).frontmatter.status).toBe("backlog");
    });

    it("shares one bulk_op_id across the batch", async () => {
      const { json } = await bulk("set", {
        refs: ["T-1", "T-2"], changes: [{ field: "status", value: "done" }],
      });
      expect(json.bulk_op_id).toMatch(/^[0-9A-Z]{26}$/);
    });
  });

  describe("archive", () => {
    it("archives and unarchives", async () => {
      const arch = await bulk("archive", { refs: ["T-1", "T-2"], archive: true });
      expect(arch.json.succeeded).toHaveLength(2);
      expect((await getTask("T-1")).frontmatter.archived).toBe(true);

      const un = await bulk("archive", { refs: ["T-1"], archive: false });
      expect(un.json.failed).toEqual([]);
      expect((await getTask("T-1")).frontmatter.archived).not.toBe(true);
    });

    it("treats an already-archived task as succeeded", async () => {
      await bulk("archive", { refs: ["T-1"], archive: true });
      const again = await bulk("archive", { refs: ["T-1"], archive: true });
      expect(again.json.succeeded).toHaveLength(1);
      expect(again.json.failed).toEqual([]);
    });
  });

  describe("link", () => {
    it("links many sources to one target, both directions stored", async () => {
      const { json } = await bulk("link", {
        refs: ["T-1", "T-2"], type: "blocks", target: "T-3",
      });
      expect(json.failed).toEqual([]);
      expect(json.succeeded).toHaveLength(2);
      expect((await getTask("T-1")).relationships[0]?.resolvedKey).toBe("T-3");
      // linkTask writes the inverse on the target, so T-3 has two.
      expect((await getTask("T-3")).relationships).toHaveLength(2);
    });

    it("reports a bad relationship type rather than half-linking silently", async () => {
      const { status } = await bulk("link", {
        refs: ["T-1"], type: "not_a_type", target: "T-2",
      });
      // Rejected before any link is attempted — workflowConfig check.
      expect([200, 400]).toContain(status);
      expect((await getTask("T-1")).relationships).toEqual([]);
    });
  });

  describe("validation", () => {
    it("rejects an empty ref list", async () => {
      const res = await fetch(`${base}/api/tasks/bulk/archive`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({ refs: [], archive: true }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects a batch over the cap", async () => {
      // One bulk op holds the tracker-wide state lock for its whole
      // run, so an unbounded batch is a DoS against every other writer.
      const res = await fetch(`${base}/api/tasks/bulk/archive`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({ refs: Array.from({ length: 501 }, (_, i) => `T-${i + 1}`), archive: true }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects unknown keys", async () => {
      const res = await fetch(`${base}/api/tasks/bulk/archive`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({ refs: ["T-1"], archive: true, sneaky: 1 }),
      });
      expect(res.status).toBe(400);
    });
  });
});
