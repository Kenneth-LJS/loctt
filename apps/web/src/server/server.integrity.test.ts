import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IntegritySummaryResponse } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * DEG-31: `GET /api/integrity` — the cheap, fixed-size summary that feeds
 * the global integrity badge. It reports counts only (never a list), is
 * `ok` iff `total === 0`, and must be derived from the cheap task/config
 * signals rather than a full doctor run.
 */
describe("GET /api/integrity (DEG-31)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-integrity-"));
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

  async function createTask(title: string): Promise<string> {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title }),
    });
    return (await res.json() as { key: string }).key;
  }

  async function corruptDueDate(): Promise<void> {
    const tasksDir = join(root, ".loctt", "tasks");
    const id = String((await readdir(tasksDir))[0]);
    const file = join(tasksDir, id, "task.md");
    const original = await readFile(file, "utf-8");
    await writeFile(file, original.replace(/^updated_at:.*$/m, m => `${m}\ndue_date: 42`), "utf-8");
  }

  // @verifies DEG-31
  it("reports ok with zero counts on a clean tracker", async () => {
    await createTask("A clean task");
    const res = await fetch(`${base}/api/integrity`);
    expect(res.status).toBe(200);
    const body = await res.json() as IntegritySummaryResponse;
    expect(body).toEqual({ ok: true, counts: { tasks: 0, config: 0 }, total: 0 });
  });

  // @verifies DEG-31
  it("returns non-zero task count and ok:false when a task is corrupt", async () => {
    await createTask("Will be corrupted");
    await corruptDueDate();
    const res = await fetch(`${base}/api/integrity`);
    expect(res.status).toBe(200);
    const body = await res.json() as IntegritySummaryResponse;
    expect(body.counts.tasks).toBe(1);
    expect(body.total).toBe(1);
    expect(body.ok).toBe(false);
  });

  // @verifies DEG-31
  it("returns a config count when a config entry is broken", async () => {
    // A hand-broken sprint (name is a number) degrades to a broken entry.
    await writeFile(
      join(root, ".loctt", "config", "sprints.yaml"),
      "sprints:\n  - id: s_bad\n    name: 5\n    start_date: 2026-01-15\n"
      + "    end_date: 2026-01-28\n    state: future\n",
      "utf-8",
    );
    const res = await fetch(`${base}/api/integrity`);
    expect(res.status).toBe(200);
    const body = await res.json() as IntegritySummaryResponse;
    expect(body.counts.config).toBe(1);
    expect(body.ok).toBe(false);
    // The response is counts only — never a list of ids.
    expect(Object.keys(body).sort()).toEqual(["counts", "ok", "total"]);
  });
});
