import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Phase-7 corruption-framework SPIKE — the web surface for one cell.
 *
 * A task whose `due_date` is wrong-typed on disk used to be unopenable in
 * the UI: GET /api/tasks/:ref threw UnreadableTaskError. The tolerant
 * fallback opens it and reports the corruption, so the detail view can
 * degrade the field and offer repair.
 */
describe("GET /api/tasks/:ref with a field-local corruption (Phase-7 spike)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };
  let id: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-corrupt-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "Corrupt one" }),
    });

    // Corrupt due_date on disk to a wrong-typed value (a bare number).
    // The task-dir name is the ULID id; we address the task by id below.
    // (SPIKE LIMITATION: a corrupt task drops out of the key index —
    // rebuildKeyIndex → loadAllTasks reads strictly — so by-KEY lookup
    // still 404s. Recorded as a Phase-7 finding: the framework must make
    // the index/list load tolerant too. The detail-view fallback is
    // demonstrated by id, which resolves without the index.)
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

  it("opens the task (200) and reports the corruption instead of failing", async () => {
    const res = await fetch(`${base}/api/tasks/${id}`);
    // Was an error before the tolerant fallback; now the task opens.
    expect(res.status).toBe(200);
    const body = await res.json() as {
      frontmatter: { title: string };
      corruptions?: { field: string; error: string }[];
    };
    // The rest of the task is intact.
    expect(body.frontmatter.title).toBe("Corrupt one");
    // ...and the corruption is named so the UI can degrade + repair.
    expect(body.corruptions).toBeDefined();
    expect(body.corruptions?.some(c => c.field === "due_date")).toBe(true);
  });

  it("a healthy task carries no corruptions field", async () => {
    const created = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "Healthy" }),
    });
    const k2 = (await created.json() as { key: string }).key;
    const res = await fetch(`${base}/api/tasks/${k2}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { corruptions?: unknown };
    expect(body.corruptions).toBeUndefined();
  });
});
