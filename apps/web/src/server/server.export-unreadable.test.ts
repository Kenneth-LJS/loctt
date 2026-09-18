import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Exporting a filter that contains a task nobody can parse.
 *
 * BLK-44 allows two outcomes and rules out a third: the export may
 * succeed and name what it skipped, or fail and name the offending
 * path — but "a truncated file that silently omits the bad row with
 * no mention" is exactly what the handler did, because it loaded
 * tasks through the call that drops unreadable ones without saying
 * so. A spreadsheet short by one row reconciles against nothing.
 *
 * @verifies BLK-44
 */
describe("GET /api/tasks/export with an unreadable task", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let victimPath: string;

  const headers = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-exportbad-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    for (const title of ["Readable one", "Readable two", "Will be corrupted"]) {
      await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title }),
      });
    }

    // Corrupt one task's frontmatter the way a bad merge would.
    const tasksDir = join(root, ".loctt", "tasks");
    const ids = await readdir(tasksDir);
    const victim = ids[ids.length - 1] ?? "";
    victimPath = join(tasksDir, victim, "task.md");
    await writeFile(victimPath, "---\nid: [not\n  valid: yaml\n---\nbody\n", "utf8");
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("still exports the readable rows", async () => {
    const res = await fetch(`${base}/api/tasks/export?format=csv`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Readable one");
    expect(body).toContain("Readable two");
    // The corrupt one genuinely cannot be exported — it will not parse.
    expect(body).not.toContain("Will be corrupted");
  });

  it("names the file it could not read, by path", async () => {
    const res = await fetch(`${base}/api/tasks/export?format=csv`);
    const header = res.headers.get("X-Loctt-Unreadable");
    expect(header).not.toBeNull();
    expect(header).toContain(victimPath);
    // A path, not a bare ULID: it is what the user acts on, and it is
    // what the list's own banner shows for the same file.
    expect(header).toContain("task.md");
  });

  it("says nothing when every task reads cleanly", async () => {
    // Restore the file so the tracker is healthy again.
    await writeFile(
      victimPath,
      "---\nid: 01M0EXPORTFIXED00000000000\nkey: T-9\ntitle: Fixed\n"
      + "status: backlog\ncreated_at: 2026-01-01T00:00:00.000Z\n"
      + "updated_at: 2026-01-01T00:00:00.000Z\n---\nbody\n",
      "utf8",
    );

    const res = await fetch(`${base}/api/tasks/export?format=csv`);
    expect(res.status).toBe(200);
    // Guards against the header being unconditionally present, which
    // would report every healthy export as partial.
    expect(res.headers.get("X-Loctt-Unreadable")).toBeNull();
  });

  it("reports the same way for JSON", async () => {
    await writeFile(victimPath, "---\nbroken: [again\n---\n", "utf8");
    const res = await fetch(`${base}/api/tasks/export?format=json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Loctt-Unreadable")).toContain("task.md");
    // And the file it did produce is valid JSON, not a truncated one.
    const text = await res.text();
    expect(() => { JSON.parse(text); }).not.toThrow();
  });
});
