import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
import { getCurrentUser, initLoctt } from "@loctt/core";
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
      expect(res.status).toBe(404);
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

  describe("invalid-JSON request bodies", () => {
    const csrfHeaders = {
      "Content-Type": "application/json",
      "X-Loctt-Client": "test",
    };

    it("returns 400 (not 500) when PUT /api/calendar gets unparseable JSON", async () => {
      const res = await fetch(`${base}/api/calendar`, {
        method: "PUT",
        headers: csrfHeaders,
        body: "{ not: 'json' ",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/invalid JSON/i);
    });

    it("returns 400 when PUT /api/user-settings gets unparseable JSON", async () => {
      const res = await fetch(`${base}/api/user-settings`, {
        method: "PUT",
        headers: csrfHeaders,
        body: "{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/invalid JSON/i);
    });

    it("returns 400 when PUT /api/user-settings gets a non-object", async () => {
      const res = await fetch(`${base}/api/user-settings`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify(["not", "an", "object"]),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/object/i);
    });

    it("returns 400 when PUT /api/user-settings nests too deeply", async () => {
      // Build a 12-level deep object (>8 limit).
      let deep: unknown = "leaf";
      for (let i = 0; i < 12; i += 1) deep = { down: deep };
      const res = await fetch(`${base}/api/user-settings`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify(deep),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/nested/i);
    });

    it("does not serve content when profile.yaml has a traversal avatar", async () => {
      // Two layers protect this:
      //  1. UserProfileSchema.avatar is a basename brand — the
      //     profile parser rejects "../foo" before the server
      //     even gets there.
      //  2. handleGetAvatar runs assertSafeBasename as
      //     defense-in-depth.
      // Whichever fires, the response must NOT be a 200 leaking
      // contents from outside the user dir.
      const current = await getCurrentUser(join(root, ".loctt"));
      if (!current) throw new Error("expected default user");
      const profilePath = join(root, ".loctt", "users", current.id, "profile.yaml");
      const original = await readFile(profilePath, "utf-8");
      try {
        await writeFile(
          profilePath,
          original + "\navatar: ../../../../../../etc/passwd\n",
          "utf-8",
        );
        const res = await fetch(`${base}/api/users/${current.id}/avatar`);
        expect(res.status).not.toBe(200);
        const body = await res.text();
        expect(body).not.toMatch(/^root:/m);
      } finally {
        await writeFile(profilePath, original, "utf-8");
      }
    });

    it("does not serve content when profile.yaml's avatar is absolute", async () => {
      const current = await getCurrentUser(join(root, ".loctt"));
      if (!current) throw new Error("expected default user");
      const profilePath = join(root, ".loctt", "users", current.id, "profile.yaml");
      const original = await readFile(profilePath, "utf-8");
      try {
        await writeFile(
          profilePath,
          original + "\navatar: /etc/passwd\n",
          "utf-8",
        );
        const res = await fetch(`${base}/api/users/${current.id}/avatar`);
        expect(res.status).not.toBe(200);
      } finally {
        await writeFile(profilePath, original, "utf-8");
      }
    });

    it("returns 400 when PUT /api/calendar gets a payload that fails schema validation", async () => {
      const res = await fetch(`${base}/api/calendar`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify({
          timezone: "Mars/Olympus_Mons",
          first_day_of_week: 1,
          working_days: [1, 2, 3, 4, 5],
          holidays: [],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/invalid calendar config/i);
    });
  });
});
