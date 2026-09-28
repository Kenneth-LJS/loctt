import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, lookupTask, resolveLocttDir } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * K140 / K141 on the web routes.
 *
 * - `POST /api/tasks` with a `parent` links it like `link` does, and a
 *   parent that does not exist is a 400 `validation_failed` at the
 *   `parent` field, with `link`'s sentence (K141 6).
 * - A key-valued edge (what `create --parent KEY` wrote before the fix)
 *   reaches the task page as a broken link; after `POST
 *   /api/doctor/repair {action:"repair-relationships"}` it resolves.
 * - `fix-all` runs the safe repairs.
 *
 * @verifies REL-C6
 * @verifies REL-C7
 */
describe("web: create with a parent, and the relationship repair", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-relrepair-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: csrf, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  async function getTask(ref: string): Promise<{ relationships: Record<string, unknown>[] }> {
    const res = await fetch(`${base}/api/tasks/${ref}`);
    return (await res.json()) as { relationships: Record<string, unknown>[] };
  }

  it("POST /api/tasks with a parent key stores the id and links both sides", async () => {
    expect((await post("/api/tasks", { title: "the parent" })).status).toBe(201);
    const child = await post("/api/tasks", { title: "the child", parent: "T-1" });
    expect(child.status).toBe(201);
    const locttDir = resolveLocttDir(root);
    const p = await lookupTask(locttDir, "T-1");
    const c = await lookupTask(locttDir, "T-2");
    // K143: both sides carry a rank.
    expect(c.frontmatter.relationships).toEqual([{ type: "parent", target: p.frontmatter.id, rank: "u" }]);
    expect(p.frontmatter.relationships).toEqual([{ type: "child", target: c.frontmatter.id, rank: "u" }]);
  });

  it("POST /api/tasks with a missing parent is a 400 at the parent field, and creates nothing", async () => {
    const res = await post("/api/tasks", { title: "orphan", parent: "NOPE-99" });
    expect(res.status).toBe(400);
    expect(res.json["code"]).toBe("validation_failed");
    expect(res.json["field"]).toBe("parent");
    expect(res.json["message"]).toBe(`Task not found: "NOPE-99"`);
    expect(res.json["data_state"]).toBe("not_saved");
    // The next create still gets T-1: no key was used up.
    expect((await post("/api/tasks", { title: "first" })).status).toBe(201);
    expect((await lookupTask(resolveLocttDir(root), "T-1")).frontmatter.title).toBe("first");
  });

  it("a key-valued edge renders as broken until the repair, then resolves", async () => {
    await post("/api/tasks", { title: "the parent" });
    await post("/api/tasks", { title: "the child" });
    const locttDir = resolveLocttDir(root);
    const c = await lookupTask(locttDir, "T-2");
    // What `create --parent T-1` wrote before the fix (ranked by the
    // 0.1.0 → 0.3.0 upgrade, as every link is since K143).
    const file = join(locttDir, "tasks", c.frontmatter.id, "task.md");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace(/^---\n$/m, "relationships:\n  - type: parent\n    target: T-1\n    rank: u\n---\n"), "utf8");

    const before = await getTask("T-2");
    expect(before.relationships).toEqual([{ type: "parent", target: "T-1", missing: true }]);

    const repair = await post("/api/doctor/repair", { action: "repair-relationships" });
    expect(repair.status).toBe(200);
    expect(repair.json).toEqual({
      action: "repair-relationships",
      relationships: { rewritten: 1, added: 1, merged: 0, ranked: 0 },
    });

    const after = await getTask("T-2");
    expect(after.relationships).toMatchObject([{ type: "parent", resolvedKey: "T-1", missing: false }]);
    const parent = await getTask("T-1");
    expect(parent.relationships).toMatchObject([{ type: "child", resolvedKey: "T-2", missing: false }]);
  });

  it("fix-all rebuilds the index and repairs relationships", async () => {
    const res = await post("/api/doctor/repair", { action: "fix-all" });
    expect(res.status).toBe(200);
    expect(res.json["action"]).toBe("fix-all");
    expect(typeof res.json["entries"]).toBe("number");
    expect(res.json["relationships"]).toEqual({ rewritten: 0, added: 0, merged: 0, ranked: 0 });
  });
});
