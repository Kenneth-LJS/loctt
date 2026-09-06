import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Phase-7 corruption framework — the web surface carries `health`.
 *
 * A task whose `due_date` is wrong-typed on disk opens (200) with its
 * degraded field reported in `health` (not among `frontmatter` fields),
 * instead of the whole task being unopenable. Replaces the Phase-7 spike
 * web test, now that the framework carries a `health` list rather than
 * the spike's `corruptions`.
 */
describe("GET /api/tasks/:ref carries field-level health", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };
  let id: string;
  let key: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-health-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "Corrupt one" }),
    });
    key = (await created.json() as { key: string }).key;

    // Corrupt due_date on disk to a wrong-typed value (a bare number).
    const { readdir } = await import("node:fs/promises");
    const tasksDir = join(root, ".loctt", "tasks");
    id = String((await readdir(tasksDir))[0]);
    const file = join(tasksDir, id, "task.md");
    const original = await readFile(file, "utf-8");
    await writeFile(file, original.replace(/^updated_at:.*$/m, m => `${m}\ndue_date: 42`), "utf-8");
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // @verifies DEG-23
  it("opens the task (200) and reports the corruption in `health`", async () => {
    const res = await fetch(`${base}/api/tasks/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      frontmatter: { title: string; due_date?: unknown };
      health?: { field: string; kind: string; rawText: string; repair: string }[];
    };
    // The rest of the task is intact.
    expect(body.frontmatter.title).toBe("Corrupt one");
    // The corrupt field is NOT among the frontmatter fields...
    expect(body.frontmatter.due_date).toBeUndefined();
    // ...it is reported in health, with its stored value as rawText.
    expect(body.health).toBeDefined();
    const entry = body.health?.find(h => h.field === "due_date");
    expect(entry?.kind).toBe("wrong_type");
    expect(entry?.rawText).toBe("42");
    expect(entry?.repair).toBe("set_or_remove");
    // `raw` is omitted from the wire.
    expect((entry as unknown as Record<string, unknown>)?.["raw"]).toBeUndefined();
  });

  it("resolves the corrupt task by key too (the index folds it)", async () => {
    const res = await fetch(`${base}/api/tasks/${key}`);
    expect(res.status).toBe(200);
  });

  // @verifies DEG-23
  it("a healthy task carries no `health` field", async () => {
    const created = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "Healthy" }),
    });
    const k2 = (await created.json() as { key: string }).key;
    const res = await fetch(`${base}/api/tasks/${k2}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { health?: unknown };
    expect(body.health).toBeUndefined();
  });
});
