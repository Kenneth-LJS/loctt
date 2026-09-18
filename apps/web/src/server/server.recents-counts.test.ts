import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Two APIs that existed and reached nothing (item 10):
 *
 *  - `pushRecent` — GET /api/recents read a list that nothing wrote,
 *    so "Recently viewed" was permanently empty.
 *  - `countTasksByReference` — Settings panels are documented to show
 *    "3 tasks use this label" and had no way to ask.
 */
describe("recents and reference counts", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-rc-"));
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

  const mk = async (title: string) => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title }),
    });
    return (await res.json()) as { key: string };
  };
  const recents = async () =>
    ((await (await fetch(`${base}/api/recents`)).json()) as { items: { key: string }[] }).items;

  describe("recents", () => {
    it("is empty before any task is opened", async () => {
      await mk("one");
      expect(await recents()).toEqual([]);
    });

    it("records a task when its detail is fetched", async () => {
      const a = await mk("one");
      await fetch(`${base}/api/tasks/${a.key}`);
      expect((await recents()).map(t => t.key)).toEqual([a.key]);
    });

    it("puts the most recently opened first", async () => {
      const a = await mk("one");
      const b = await mk("two");
      await fetch(`${base}/api/tasks/${a.key}`);
      await fetch(`${base}/api/tasks/${b.key}`);
      expect((await recents()).map(t => t.key)).toEqual([b.key, a.key]);
    });

    it("does not duplicate a task opened twice", async () => {
      const a = await mk("one");
      await fetch(`${base}/api/tasks/${a.key}`);
      await fetch(`${base}/api/tasks/${a.key}`);
      expect((await recents()).map(t => t.key)).toEqual([a.key]);
    });
  });

  describe("reference counts", () => {
    it("omits taskCount unless asked", async () => {
      // The sidebar renders these lists on every page load and does not
      // need counts; computing them scans every task.
      await fetch(`${base}/api/labels`, {
        method: "POST", headers: csrf, body: JSON.stringify({ name: "bug" }),
      });
      const items = ((await (await fetch(`${base}/api/labels`)).json()) as
        { items: Record<string, unknown>[] }).items;
      expect(items[0]).not.toHaveProperty("taskCount");
    });

    it("reports how many tasks use each label with ?counts=true", async () => {
      const created = await (await fetch(`${base}/api/labels`, {
        method: "POST", headers: csrf, body: JSON.stringify({ name: "bug" }),
      })).json() as { id: string };
      const a = await mk("tagged");
      await mk("untagged");
      await fetch(`${base}/api/tasks/${a.key}/set`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({ field: "labels", value: [created.id] }),
      });

      const items = ((await (await fetch(`${base}/api/labels?counts=true`)).json()) as
        { items: { id: string; taskCount: number }[] }).items;
      expect(items.find(l => l.id === created.id)?.taskCount).toBe(1);
    });

    it("reports milestone progress with ?progress=true", async () => {
      // Computed from status CATEGORY, never a status key: a tracker
      // may rename or delete `done` entirely (MSL-3).
      const ms = await (await fetch(`${base}/api/milestones`, {
        method: "POST", headers: csrf, body: JSON.stringify({ name: "v1" }),
      })).json() as { id: string };

      const a = await mk("shipped");
      const b = await mk("outstanding");
      const c = await mk("abandoned");
      for (const [key, status] of [[a.key, "done"], [b.key, "backlog"], [c.key, "wont_do"]] as const) {
        await fetch(`${base}/api/tasks/${key}/set`, {
          method: "POST", headers: csrf,
          body: JSON.stringify({ field: "milestone", value: ms.id }),
        });
        await fetch(`${base}/api/tasks/${key}/set`, {
          method: "POST", headers: csrf,
          body: JSON.stringify({ field: "status", value: status }),
        });
      }

      const items = ((await (await fetch(`${base}/api/milestones?progress=true`)).json()) as
        { items: { id: string; progress: { done: number; total: number; discarded: number } }[] }).items;
      const p = items.find(m => m.id === ms.id)?.progress;
      // 1 done, 1 outstanding, 1 discarded → 1/2, not 1/3.
      expect(p).toMatchObject({ done: 1, total: 2, discarded: 1 });
    });

    it("omits progress unless asked", async () => {
      await fetch(`${base}/api/milestones`, {
        method: "POST", headers: csrf, body: JSON.stringify({ name: "v1" }),
      });
      const items = ((await (await fetch(`${base}/api/milestones`)).json()) as
        { items: Record<string, unknown>[] }).items;
      expect(items[0]).not.toHaveProperty("progress");
    });

    it("reports zero for an unused entity rather than omitting it", async () => {
      await fetch(`${base}/api/labels`, {
        method: "POST", headers: csrf, body: JSON.stringify({ name: "unused" }),
      });
      const items = ((await (await fetch(`${base}/api/labels?counts=true`)).json()) as
        { items: { taskCount: number }[] }).items;
      expect(items[0]?.taskCount).toBe(0);
    });
  });
});
