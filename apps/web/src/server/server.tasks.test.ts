import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `GET /api/tasks` — the M1.2 sort/pagination surface. Backed by a
 * real tracker (the existing convention in this suite); core's own
 * sort/query logic is tested in packages/core, so these assert the
 * route maps `?sort=&dir=` correctly, validates `dir`, and paginates.
 */
describe("GET /api/tasks (sort + pagination)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-tasks-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    for (const title of ["Apple", "Cherry", "Banana"]) {
      await fetch(`${base}/api/tasks`, { method: "POST", headers: csrf, body: JSON.stringify({ title }) });
    }
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function list(qs: string): Promise<{ items: TaskFrontmatterPublic[]; total: number }> {
    const res = await fetch(`${base}/api/tasks?${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()) as { items: TaskFrontmatterPublic[]; total: number };
  }

  it("sorts ascending by a field", async () => {
    const { items } = await list("sort=title&dir=asc");
    expect(items.map(t => t.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("sorts descending by a field", async () => {
    const { items } = await list("sort=title&dir=desc");
    expect(items.map(t => t.title)).toEqual(["Cherry", "Banana", "Apple"]);
  });

  it("defaults dir to ascending when only sort is given", async () => {
    const { items } = await list("sort=title");
    expect(items.map(t => t.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("rejects an invalid dir with 400", async () => {
    const res = await fetch(`${base}/api/tasks?sort=title&dir=sideways`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("dir");
  });

  it("reports the full total independent of the page slice", async () => {
    const { items, total } = await list("sort=title&dir=asc&limit=2&offset=0");
    expect(items).toHaveLength(2);
    expect(total).toBe(3);
  });
});
