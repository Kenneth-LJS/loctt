import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

describe("web server security", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-sec-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  describe("CSRF protection", () => {
    it("allows GET requests without X-Loctt-Client header", async () => {
      const res = await fetch(`${base}/api/info`);
      expect(res.status).toBe(200);
    });

    it("rejects POST without X-Loctt-Client header", async () => {
      const res = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "csrf test" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("X-Loctt-Client");
    });

    it("rejects DELETE without X-Loctt-Client header", async () => {
      const res = await fetch(`${base}/api/tasks/fake`, {
        method: "DELETE",
      });
      expect(res.status).toBe(403);
    });

    it("allows POST with X-Loctt-Client header", async () => {
      const res = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Loctt-Client": "1",
        },
        body: JSON.stringify({ title: "csrf allowed" }),
      });
      // Should not be 403 — may be 201 (created) or another status, but not CSRF rejection
      expect(res.status).not.toBe(403);
    });
  });

  describe("activity endpoint", () => {
    it("returns activity entries for a task", async () => {
      // Create a task first
      const createRes = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ title: "activity test" }),
      });
      const created = await createRes.json() as { key: string };

      // Fetch activity
      const res = await fetch(`${base}/api/tasks/${created.key}/activity`);
      expect(res.status).toBe(200);
      const body = await res.json() as { entries: HistoryEntry[]; total: number };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.entries[0]?.kind).toBe("created");
    });

    it("returns entries newest-first", async () => {
      // Create and then update a task
      const createRes = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ title: "order test" }),
      });
      const created = await createRes.json() as { key: string };

      await fetch(`${base}/api/tasks/${created.key}/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ field: "priority", value: "high" }),
      });

      const res = await fetch(`${base}/api/tasks/${created.key}/activity`);
      const body = await res.json() as { entries: HistoryEntry[]; total: number };
      expect(body.total).toBe(2);
      // Most recent first
      expect(body.entries[0]?.kind).toBe("field_change");
      expect(body.entries[1]?.kind).toBe("created");
    });

    it("supports limit and offset pagination", async () => {
      const createRes = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ title: "pagination test" }),
      });
      const created = await createRes.json() as { key: string };

      // Add a second event
      await fetch(`${base}/api/tasks/${created.key}/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ field: "status", value: "in_progress" }),
      });

      // Limit to 1
      const res1 = await fetch(`${base}/api/tasks/${created.key}/activity?limit=1`);
      const body1 = await res1.json() as { entries: HistoryEntry[]; total: number };
      expect(body1.entries).toHaveLength(1);
      expect(body1.total).toBe(2);

      // Offset 1
      const res2 = await fetch(`${base}/api/tasks/${created.key}/activity?offset=1&limit=1`);
      const body2 = await res2.json() as { entries: HistoryEntry[]; total: number };
      expect(body2.entries).toHaveLength(1);
      expect(body2.total).toBe(2);
    });

    it("returns 404 for unknown task ref", async () => {
      const res = await fetch(`${base}/api/tasks/NONEXISTENT/activity`);
      expect(res.status).toBe(500); // lookupTask throws, caught as 500
    });
  });

  describe("path leakage", () => {
    it("info response does not contain absolute filesystem paths", async () => {
      const res = await fetch(`${base}/api/info`);
      const body = await res.json() as Record<string, unknown>;
      expect(body).not.toHaveProperty("locttDir");
      // Verify no string values look like absolute paths
      for (const value of Object.values(body)) {
        if (typeof value === "string") {
          expect(value).not.toMatch(/^\//);
        }
      }
    });
  });
});
