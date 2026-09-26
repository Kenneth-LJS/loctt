import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTaskFilePath, initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies SET-25
 *
 * Amended (K116, Ken 2026-09-23): the panel's explanatory copy about
 * date-only vs. datetime fields moved to the user docs, so what remains
 * to test here is the underlying behaviour SET-25 still asserts —
 * `PUT /api/calendar` changes only `calendar.yaml`. It must never
 * rewrite a task's stored `due_date`, because the display formatter
 * (`workspaceDate.ts`) already applies the workspace timezone at
 * render time; a write-back here would double-apply the shift and
 * corrupt the stored value the CLI and MCP also read.
 *
 * This is a server/task-file test, not a client one: `workspaceDate.
 * test.ts` already covers the pure formatting side (same stored value,
 * different rendered string per timezone). What that unit test cannot
 * see is whether changing the setting ever touches disk beyond
 * `calendar.yaml` — that requires a real task file and a real write.
 */
describe("PUT /api/calendar leaves task files untouched (SET-25)", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const WRITE = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-calendar-tz-"));
    await initLoctt(root);
    locttDir = join(root, ".loctt");
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("switching from UTC to Asia/Singapore does not rewrite the task's due_date or the file at all", async () => {
    const created = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: WRITE,
      body: JSON.stringify({ title: "ships on schedule", due_date: "2026-06-08" }),
    });
    expect(created.status).toBe(201);
    const task = await created.json() as { id: string; due_date?: string };
    expect(task.due_date).toBe("2026-06-08");

    const filePath = getTaskFilePath(locttDir, task.id);
    const before = await readFile(filePath, "utf8");

    const put = await fetch(`${base}/api/calendar`, {
      method: "PUT",
      headers: WRITE,
      body: JSON.stringify({
        timezone: "Asia/Singapore",
        first_day_of_week: 1,
        working_days: [1, 2, 3, 4, 5],
        holidays: [],
      }),
    });
    expect(put.status).toBe(200);

    // The far end: the task's own file on disk, byte for byte. A
    // display-layer timezone change has no business touching it.
    const after = await readFile(filePath, "utf8");
    expect(after).toBe(before);

    const reread = await fetch(`${base}/api/tasks/${task.id}`);
    const rereadBody = await reread.json() as { frontmatter: { due_date?: string } };
    expect(rereadBody.frontmatter.due_date).toBe("2026-06-08");
  });

  it("reverting the timezone still leaves the stored due_date exactly as it was", async () => {
    const created = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: WRITE,
      body: JSON.stringify({ title: "round trip", due_date: "2026-01-01" }),
    });
    const task = await created.json() as { id: string };
    const filePath = getTaskFilePath(locttDir, task.id);
    const original = await readFile(filePath, "utf8");

    const calendarBody = (timezone: string) => JSON.stringify({
      timezone,
      first_day_of_week: 1,
      working_days: [1, 2, 3, 4, 5],
      holidays: [],
    });

    await fetch(`${base}/api/calendar`, { method: "PUT", headers: WRITE, body: calendarBody("Asia/Singapore") });
    await fetch(`${base}/api/calendar`, { method: "PUT", headers: WRITE, body: calendarBody("UTC") });

    const after = await readFile(filePath, "utf8");
    expect(after).toBe(original);
  });
});
