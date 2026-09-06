import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `DELETE /api/labels/:id` and `DELETE /api/milestones/:id` (MSL-12,
 * MSL-13, MSL-32).
 *
 * Both routes called core's `deleteLabel`/`deleteMilestone` without
 * `hard`, whose default is `false`. Two defects fell out of that:
 *
 *  1. A delete **archived** while answering `200 {"deleted": id}`. The
 *     entry stayed in the config file with `archived: true`, so a user
 *     who deleted a label still had it. This is the same shape as the
 *     `DELETE /api/projects/:id` defect M4.1 fixed.
 *  2. `?remap_to=` was unreachable. Core's soft path *throws* when
 *     `remapTo` is set, so the remap MSL-12 requires came back as
 *     `400 --remap-to only applies to --hard delete` — a CLI flag name
 *     leaked into an HTTP response.
 *
 * Every assertion here reads `labels.yaml` / `milestones.yaml` off
 * disk rather than trusting the response body, because the response
 * body was the thing that lied.
 */
describe("data-panel deletes are deletes", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-dd-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const labelsYaml = () => readFile(join(root, ".loctt/config/labels.yaml"), "utf8");
  const milestonesYaml = () => readFile(join(root, ".loctt/config/milestones.yaml"), "utf8");
  const sprintsYaml = () => readFile(join(root, ".loctt/config/sprints.yaml"), "utf8");

  const mkSprint = async (name: string) =>
    (await (await fetch(`${base}/api/sprints`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({
        name,
        start_date: "2026-01-01",
        end_date: "2026-01-14",
        state: "active",
      }),
    })).json()) as { id: string; name: string };

  const mkLabel = async (name: string, color?: string) =>
    (await (await fetch(`${base}/api/labels`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ name, ...(color !== undefined ? { color } : {}) }),
    })).json()) as { id: string; name: string };

  const mkMilestone = async (name: string) =>
    (await (await fetch(`${base}/api/milestones`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ name }),
    })).json()) as { id: string; name: string };

  const mkTask = async (title: string) =>
    (await (await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title }),
    })).json()) as { key: string };

  describe("labels", () => {
    /** @verifies MSL-12 */
  it("removes the entry from labels.yaml rather than archiving it", async () => {
      const label = await mkLabel("bug");
      expect(await labelsYaml()).toContain(label.id);

      const res = await fetch(`${base}/api/labels/${label.id}`, {
        method: "DELETE", headers: csrf,
      });
      expect(res.status).toBe(200);

      // The far end. Before the fix this file still held the id with
      // `archived: true` and the response above was still a 200.
      const after = await labelsYaml();
      expect(after).not.toContain(label.id);
      expect(after).not.toContain("archived");
    });

    /** @verifies MSL-12 */
  it("applies ?remap_to= to the tasks that referenced the deleted label", async () => {
      const from = await mkLabel("old");
      const to = await mkLabel("new");
      const task = await mkTask("carries the label");
      await fetch(`${base}/api/tasks/${task.key}/set`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({ field: "labels", value: [from.id] }),
      });

      const res = await fetch(
        `${base}/api/labels/${from.id}?remap_to=${to.id}`,
        { method: "DELETE", headers: csrf },
      );
      // Before the fix this was a 400 carrying "--remap-to only applies
      // to --hard delete" — the remap was unreachable over HTTP.
      expect(res.status).toBe(200);
      expect((await res.json() as { affectedTaskCount: number }).affectedTaskCount).toBe(1);

      const detail = await (await fetch(`${base}/api/tasks/${task.key}`)).json() as {
        frontmatter: { labels?: readonly string[] };
      };
      // The reference moved to the survivor rather than being dropped.
      expect(detail.frontmatter.labels).toEqual([to.id]);

      const after = await labelsYaml();
      expect(after).not.toContain(from.id);
      expect(after).toContain(to.id);
    });

    it("still exposes archive, as ?soft=true", async () => {
      const label = await mkLabel("keepme");
      const res = await fetch(`${base}/api/labels/${label.id}?soft=true`, {
        method: "DELETE", headers: csrf,
      });
      expect(res.status).toBe(200);

      // Soft is the opposite assertion: the entry survives, flagged.
      const after = await labelsYaml();
      expect(after).toContain(label.id);
      expect(after).toContain("archived");
    });

    /**
     * MSL-33: when a label remap only partly lands over HTTP, the route
     * must report the split (409 conflict, retryable, failures named by
     * key) rather than a blanket success or a rejected write, and must
     * NOT remove the label — its tasks still reference it. Mirrors the
     * project route's PartialRemapError branch. Two tasks so "some
     * moved, some did not" is distinguishable.
     */
    /** @verifies MSL-33 */
    it("reports a partial remap as a retryable 409 and keeps the label", async () => {
      const from = await mkLabel("retiring");
      const to = await mkLabel("survivor");
      const moved = await mkTask("moves fine");
      const stuck = await mkTask("cannot be written");
      for (const t of [moved, stuck]) {
        await fetch(`${base}/api/tasks/${t.key}/set`, {
          method: "POST", headers: csrf,
          body: JSON.stringify({ field: "labels", value: [from.id] }),
        });
      }

      // Find the unwritable task's dir by its id (not key) and lock it.
      const stuckDetail = await (await fetch(`${base}/api/tasks/${stuck.key}`)).json() as {
        frontmatter: { id: string; key: string };
      };
      const victimDir = join(root, ".loctt", "tasks", stuckDetail.frontmatter.id);
      await chmod(victimDir, 0o500);

      let body: { code?: string; recovery?: unknown; failures?: { ref: string }[] };
      let status: number;
      try {
        const res = await fetch(`${base}/api/labels/${from.id}?remap_to=${to.id}`, {
          method: "DELETE", headers: csrf,
        });
        status = res.status;
        body = await res.json() as typeof body;
      } finally {
        await chmod(victimDir, 0o700);
      }

      // Not 200 (blanket success) and not 400 (rejected write): a 409
      // that says some tasks moved and names the failure by key.
      expect(status).toBe(409);
      expect(body.code).toBe("conflict");
      expect(body.recovery).toEqual({ kind: "retry" });
      expect(body.failures?.map(f => f.ref)).toEqual([stuckDetail.frontmatter.key]);

      // The label is NOT gone — deleting it would strand `stuck`.
      const after = await labelsYaml();
      expect(after).toContain(from.id);

      // And the task that COULD be written did move — the split is real,
      // not an all-or-nothing rollback.
      const movedDetail = await (await fetch(`${base}/api/tasks/${moved.key}`)).json() as {
        frontmatter: { labels?: readonly string[] };
      };
      expect(movedDetail.frontmatter.labels).toEqual([to.id]);
    });
  });

  describe("label archive/unarchive routes", () => {
    /**
     * MSL-10. `archiveLabel`/`unarchiveLabel` were exported from core
     * and called only by the CLI — the web had no route, so the UI's
     * only way to remove a label from the pickers was to delete it,
     * which is the thing MSL-10 exists to avoid.
     */
    /** @verifies MSL-10 */
  it("archives a label without removing it or its references", async () => {
      const label = await mkLabel("legacy");
      const task = await mkTask("still tagged");
      await fetch(`${base}/api/tasks/${task.key}/set`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({ field: "labels", value: [label.id] }),
      });

      const res = await fetch(`${base}/api/labels/${label.id}/archive`, {
        method: "POST", headers: csrf, body: "{}",
      });
      expect(res.status).toBe(200);

      const after = await labelsYaml();
      expect(after).toContain(label.id);
      expect(after).toContain("archived");

      // The reference survives — that is the whole point of archiving.
      const detail = await (await fetch(`${base}/api/tasks/${task.key}`)).json() as {
        frontmatter: { labels?: readonly string[] };
      };
      expect(detail.frontmatter.labels).toEqual([label.id]);
    });

    /** @verifies MSL-10 */
  it("unarchives a label, clearing the flag", async () => {
      const label = await mkLabel("returning");
      await fetch(`${base}/api/labels/${label.id}/archive`, {
        method: "POST", headers: csrf, body: "{}",
      });
      expect(await labelsYaml()).toContain("archived");

      const res = await fetch(`${base}/api/labels/${label.id}/unarchive`, {
        method: "POST", headers: csrf, body: "{}",
      });
      expect(res.status).toBe(200);
      expect(await labelsYaml()).not.toContain("archived");
    });

    it("reports an unknown label rather than 404ing the route itself", async () => {
      const res = await fetch(`${base}/api/labels/NOPE/archive`, {
        method: "POST", headers: csrf, body: "{}",
      });
      // 400 with core's message, not a 404 route-miss: the route
      // exists, the label does not.
      expect(res.status).toBe(400);
      expect((await res.json() as { message: string }).message).toContain("unknown label");
    });
  });

  describe("milestones", () => {
    it("removes the entry from milestones.yaml rather than archiving it", async () => {
      const ms = await mkMilestone("v1");
      expect(await milestonesYaml()).toContain(ms.id);

      const res = await fetch(`${base}/api/milestones/${ms.id}`, {
        method: "DELETE", headers: csrf,
      });
      expect(res.status).toBe(200);

      const after = await milestonesYaml();
      expect(after).not.toContain(ms.id);
      expect(after).not.toContain("archived");
    });

    /** @verifies MSL-13 */
  it("applies ?remap_to= to the tasks that referenced the deleted milestone", async () => {
      const from = await mkMilestone("v1");
      const to = await mkMilestone("v2");
      const task = await mkTask("in the milestone");
      await fetch(`${base}/api/tasks/${task.key}/set`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({ field: "milestone", value: from.id }),
      });

      const res = await fetch(
        `${base}/api/milestones/${from.id}?remap_to=${to.id}`,
        { method: "DELETE", headers: csrf },
      );
      expect(res.status).toBe(200);
      expect((await res.json() as { affectedTaskCount: number }).affectedTaskCount).toBe(1);

      const detail = await (await fetch(`${base}/api/tasks/${task.key}`)).json() as {
        frontmatter: { milestone?: string };
      };
      expect(detail.frontmatter.milestone).toBe(to.id);
    });

    it("still exposes archive, as ?soft=true", async () => {
      const ms = await mkMilestone("later");
      const res = await fetch(`${base}/api/milestones/${ms.id}?soft=true`, {
        method: "DELETE", headers: csrf,
      });
      expect(res.status).toBe(200);
      const after = await milestonesYaml();
      expect(after).toContain(ms.id);
      expect(after).toContain("archived");
    });
  });

  describe("sprint archive/unarchive routes", () => {
    /**
     * SPR-40. `archiveSprint`/`unarchiveSprint` were exported from core
     * and called only by the CLI and MCP — the web had no route and
     * `handleUpdateSprint` never accepted `archived`, so the SprintsPanel
     * could split archived from active for reading but had no way to
     * archive. Mirrors the label archive/unarchive routes.
     */
    /** @verifies SPR-40 */
    it("archives a sprint, setting the flag without removing the entry", async () => {
      const sprint = await mkSprint("Q1 push");
      expect(await sprintsYaml()).not.toContain("archived");

      const res = await fetch(`${base}/api/sprints/${sprint.id}/archive`, {
        method: "POST", headers: csrf, body: "{}",
      });
      expect(res.status).toBe(200);
      expect((await res.json() as { archived: string }).archived).toBe(sprint.id);

      const after = await sprintsYaml();
      expect(after).toContain(sprint.id);
      expect(after).toContain("archived");
    });

    /** @verifies SPR-40 */
    it("unarchives a sprint, clearing the flag (round-trip)", async () => {
      const sprint = await mkSprint("returning");
      await fetch(`${base}/api/sprints/${sprint.id}/archive`, {
        method: "POST", headers: csrf, body: "{}",
      });
      expect(await sprintsYaml()).toContain("archived");

      const res = await fetch(`${base}/api/sprints/${sprint.id}/unarchive`, {
        method: "POST", headers: csrf, body: "{}",
      });
      expect(res.status).toBe(200);
      expect((await res.json() as { unarchived: string }).unarchived).toBe(sprint.id);
      expect(await sprintsYaml()).not.toContain("archived");
    });

    it("enforces CSRF on the archive route", async () => {
      const sprint = await mkSprint("guarded");
      const res = await fetch(`${base}/api/sprints/${sprint.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(403);
      // The write did not happen.
      expect(await sprintsYaml()).not.toContain("archived");
    });

    it("reports an unknown sprint rather than 404ing the route itself", async () => {
      const res = await fetch(`${base}/api/sprints/NOPE/archive`, {
        method: "POST", headers: csrf, body: "{}",
      });
      expect(res.status).toBe(400);
      expect((await res.json() as { message: string }).message).toContain("unknown sprint");
    });
  });
});
