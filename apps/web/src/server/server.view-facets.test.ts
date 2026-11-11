import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Issue #9: with a saved view open, the toolbar's facet params
 * (`status=…`, `priority=…`, …) were dropped server-side, so picking
 * "Backlog, In progress" on a label view still listed Done and Won't do
 * tasks. The facets must AND with the view's own filters.
 *
 * The fixture discriminates: the view matches three tasks, the facet
 * keeps one of them, and a fourth task matches the facet but not the
 * view — so "facet ignored" (3 rows) and "view ignored" (2 rows) both
 * fail.
 */
describe("GET /api/tasks with a saved view and toolbar facets", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const headers = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  const QUERIES = `queries:
  - id: 01J0000000000000000000001
    name: high-only
    filters:
      - kind: simple
        field: priority
        op: in
        values: [high]
`;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-viewfacets-"));
    await initLoctt(root);
    await writeFile(join(root, ".loctt/config/queries.yaml"), QUERIES);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;

    const make = async (title: string, status: string, priority: string): Promise<void> => {
      const res = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title, status, priority }),
      });
      expect(res.ok).toBe(true);
    };
    await make("high backlog", "backlog", "high");
    await make("high done", "done", "high");
    await make("high wont", "wont_do", "high");
    await make("low backlog", "backlog", "low");
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const titles = async (qs: string): Promise<string[]> => {
    const res = await fetch(`${base}/api/tasks?${qs}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { title: string }[] };
    return body.items.map(t => t.title).sort();
  };

  it("the view alone matches its three tasks (positive control)", async () => {
    expect(await titles("view=high-only")).toEqual(["high backlog", "high done", "high wont"]);
  });

  // @verifies VUE-44
  it("a status facet narrows the view instead of being dropped", async () => {
    expect(await titles("view=high-only&status=backlog,in_progress"))
      .toEqual(["high backlog"]);
  });

  // @verifies VUE-44
  it("a facet on another field narrows the view too", async () => {
    // `priority=low` ANDed with the view's `priority in (high)` is empty —
    // proof the facet reaches core rather than replacing the view.
    expect(await titles("view=high-only&priority=low")).toEqual([]);
  });
});
