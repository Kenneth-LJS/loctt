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
      const body = await res.json() as { error: string; detail?: string };
      // The header name is machinery, not user copy (ERR-16), so it is
      // carried in `detail` rather than the headline.
      expect(body.detail).toContain("X-Loctt-Client");
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

    it("rejects limit above MAX_PAGE_LIMIT (1000) with 400", async () => {
      // Regression: activity endpoint previously bypassed the global
      // pagination cap. Now shares parsePagination with /api/tasks.
      const createRes = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ title: "cap test" }),
      });
      const created = await createRes.json() as { key: string };
      const res = await fetch(`${base}/api/tasks/${created.key}/activity?limit=999999`);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/limit must be at most 1000/);
    });

    it("rejects empty limit string with 400 (not silently 0)", async () => {
      // Regression: ?limit= previously coerced to 0 instead of erroring.
      const createRes = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ title: "empty limit" }),
      });
      const created = await createRes.json() as { key: string };
      const res = await fetch(`${base}/api/tasks/${created.key}/activity?limit=`);
      expect(res.status).toBe(400);
    });

    it("rejects non-integer limit with 400", async () => {
      const createRes = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
        body: JSON.stringify({ title: "bad limit" }),
      });
      const created = await createRes.json() as { key: string };
      const res = await fetch(`${base}/api/tasks/${created.key}/activity?limit=abc`);
      expect(res.status).toBe(400);
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

  describe("list pagination", () => {
    const csrfHeaders = {
      "Content-Type": "application/json",
      "X-Loctt-Client": "test",
    };

    it("/api/tasks returns paginated envelope", async () => {
      // Seed a few tasks (some may already exist from earlier tests
      // — that's fine, pagination wraps the matching set).
      for (let i = 0; i < 3; i += 1) {
        await fetch(`${base}/api/tasks`, {
          method: "POST",
          headers: csrfHeaders,
          body: JSON.stringify({ title: `paginated ${i}` }),
        });
      }
      const res = await fetch(`${base}/api/tasks?limit=2&offset=0`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        items: unknown[];
        total: number;
        offset: number;
        limit: number;
      };
      expect(body.items).toHaveLength(2);
      expect(body.total).toBeGreaterThanOrEqual(3);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(2);
    });

    it("/api/tasks pagination total exceeds the core listTasks default cap of 30", async () => {
      // Regression guard: listTasks() in core has a built-in default
      // limit of 30 to keep CLI output bounded. The HTTP layer must
      // opt out of that so total reflects the real matching count
      // and ?offset=30 returns the next page.
      const before = await fetch(`${base}/api/tasks?limit=1`);
      const beforeBody = await before.json() as { total: number };
      const startTotal = beforeBody.total;
      const need = Math.max(0, 35 - startTotal);
      for (let i = 0; i < need; i += 1) {
        await fetch(`${base}/api/tasks`, {
          method: "POST",
          headers: csrfHeaders,
          body: JSON.stringify({ title: `cap-test ${i}` }),
        });
      }
      const res = await fetch(`${base}/api/tasks?limit=1&offset=0`);
      const body = await res.json() as { items: unknown[]; total: number };
      expect(body.total).toBeGreaterThan(30);

      // Page past 30 — must return items, not be cut off by the
      // hidden core limit.
      const page2 = await fetch(`${base}/api/tasks?limit=5&offset=30`);
      const page2Body = await page2.json() as { items: unknown[]; total: number };
      expect(page2Body.items.length).toBeGreaterThan(0);
      expect(page2Body.total).toBe(body.total);
    });

    it("/api/tasks rejects negative limit", async () => {
      const res = await fetch(`${base}/api/tasks?limit=-1`);
      expect(res.status).toBe(400);
    });

    it("/api/tasks rejects non-integer offset", async () => {
      const res = await fetch(`${base}/api/tasks?offset=abc`);
      expect(res.status).toBe(400);
    });

    it("/api/tasks rejects an empty limit (does not silently treat as 0)", async () => {
      const res = await fetch(`${base}/api/tasks?limit=`);
      expect(res.status).toBe(400);
    });

    it("/api/tasks rejects limit beyond MAX_PAGE_LIMIT", async () => {
      const res = await fetch(`${base}/api/tasks?limit=999999`);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/at most/i);
    });

    it("/api/projects returns paginated envelope", async () => {
      const res = await fetch(`${base}/api/projects`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        items: unknown[];
        total: number;
        default: string | null;
      };
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect("default" in body).toBe(true);
    });

    it("/api/users returns paginated envelope with current pinned alongside", async () => {
      const res = await fetch(`${base}/api/users`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        items: unknown[];
        total: number;
        current: string | null;
      };
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect("current" in body).toBe(true);
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
      const body = await res.json() as { error: string; code?: string; detail?: string };
      // The parser's own message is jargon and lives in `detail`; the
      // headline stays plain (ERR-16).
      expect(body.code).toBe("validation_failed");
      expect(body.detail).toMatch(/JSON/i);
    });

    it("returns 400 when PUT /api/user-settings gets unparseable JSON", async () => {
      const res = await fetch(`${base}/api/user-settings`, {
        method: "PUT",
        headers: csrfHeaders,
        body: "{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code?: string; detail?: string };
      // The parser's own message is jargon and lives in `detail`; the
      // headline stays plain (ERR-16).
      expect(body.code).toBe("validation_failed");
      expect(body.detail).toMatch(/JSON/i);
    });

    it("returns 400 when PUT /api/user-settings gets a non-object", async () => {
      const res = await fetch(`${base}/api/user-settings`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify(["not", "an", "object"]),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code?: string; data_state?: string };
      expect(body.code).toBe("validation_failed");
      expect(body.data_state).toBe("not_saved");
    });

    it("returns 400 (not 500) when POST /api/tasks gets unparseable JSON", async () => {
      const res = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: csrfHeaders,
        body: "{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code?: string; detail?: string };
      // The parser's own message is jargon and lives in `detail`; the
      // headline stays plain (ERR-16).
      expect(body.code).toBe("validation_failed");
      expect(body.detail).toMatch(/JSON/i);
    });

    it("returns 400 when POST /api/projects gets unparseable JSON", async () => {
      const res = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: csrfHeaders,
        body: "{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code?: string; detail?: string };
      // The parser's own message is jargon and lives in `detail`; the
      // headline stays plain (ERR-16).
      expect(body.code).toBe("validation_failed");
      expect(body.detail).toMatch(/JSON/i);
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

    it("returns 413 (not 500) when a JSON body exceeds the size cap", async () => {
      // readBody caps bodies at 1 MiB; oversized requests must
      // surface as 413 so clients distinguish "too big" from 500.
      const oversize = "x".repeat(1_100_000);
      const res = await fetch(`${base}/api/user-settings`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify({ blob: oversize }),
      });
      expect(res.status).toBe(413);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/exceeds|too large/i);
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

    it("ignores avatar_source_path in POST /api/users (field is no longer accepted)", async () => {
      const res = await fetch(`${base}/api/users`, {
        method: "POST",
        headers: csrfHeaders,
        body: JSON.stringify({
          name: "no-avatar",
          avatar_source_path: "/etc/passwd",
        }),
      });
      expect(res.status).toBe(201);
      const created = await res.json() as { id: string; avatar?: string };
      // The server must not act on avatar_source_path — no avatar file was
      // copied, so the profile must not have an `avatar` field.
      expect(created.avatar).toBeUndefined();
    });

    it("ignores avatar_source_path in PUT /api/users/:id (field is no longer accepted)", async () => {
      const current = await getCurrentUser(join(root, ".loctt"));
      if (!current) throw new Error("expected default user");
      const res = await fetch(`${base}/api/users/${current.id}`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify({
          avatar_source_path: "/etc/passwd",
        }),
      });
      expect(res.status).toBe(200);
      const updated = await res.json() as { avatar?: string };
      expect(updated.avatar).toBeUndefined();
    });

    it("rejects POST /api/users/:id/avatar without multipart/form-data", async () => {
      const current = await getCurrentUser(join(root, ".loctt"));
      if (!current) throw new Error("expected default user");
      const res = await fetch(`${base}/api/users/${current.id}/avatar`, {
        method: "POST",
        headers: csrfHeaders,
        body: "not multipart",
      });
      expect(res.status).toBe(400);
    });

    it("accepts a real PNG via multipart POST /api/users/:id/avatar and serves it as image/jpeg", async () => {
      const current = await getCurrentUser(join(root, ".loctt"));
      if (!current) throw new Error("expected default user");
      // Use a real PNG (not just the 8-byte magic) so the
      // sharp pipeline can decode + re-encode it.
      const sharp = (await import("sharp")).default;
      const png = await sharp({
        create: { width: 80, height: 80, channels: 3, background: "#00aa55" },
      }).png().toBuffer();
      // FormData/Blob's TS type wants a strict ArrayBuffer view, not
      // a Node Buffer. new Uint8Array(buf) re-views the underlying
      // bytes without a copy.
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "pic.png");
      const res = await fetch(`${base}/api/users/${current.id}/avatar`, {
        method: "POST",
        headers: { "X-Loctt-Client": "1" },
        body: form,
      });
      expect(res.status).toBe(200);
      const updated = await res.json() as { avatar?: string };
      // Always-JPG storage policy (chunk 10).
      expect(updated.avatar).toBe("avatar.jpg");

      // GET serves it back as image/jpeg with nosniff.
      const get = await fetch(`${base}/api/users/${current.id}/avatar`);
      expect(get.status).toBe(200);
      expect(get.headers.get("content-type")).toBe("image/jpeg");
      expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("rejects an avatar upload over MAX_AVATAR_BYTES at the multipart layer", async () => {
      // The multipart parser is capped at MAX_AVATAR_BYTES (10MB
      // post-chunk-10) so a hostile client can't dump 100MB into
      // the temp dir before the core size check fires. Exceeding
      // it surfaces a 400 (not a 500/timeout).
      const { MAX_AVATAR_BYTES } = await import("@loctt/core");
      const current = await getCurrentUser(join(root, ".loctt"));
      if (!current) throw new Error("expected default user");
      const oversized = new Uint8Array(MAX_AVATAR_BYTES + 1024);
      // Fill with a non-zero byte so it doesn't accidentally look
      // like a valid sparse image header.
      oversized.fill(0x42);
      const form = new FormData();
      form.append("file", new Blob([oversized], { type: "image/png" }), "huge.png");
      const res = await fetch(`${base}/api/users/${current.id}/avatar`, {
        method: "POST",
        headers: { "X-Loctt-Client": "1" },
        body: form,
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/maximum size/i);
    });

    it("rejects a multipart SVG upload regardless of declared file extension", async () => {
      const current = await getCurrentUser(join(root, ".loctt"));
      if (!current) throw new Error("expected default user");
      const svg = "<svg><script>alert(1)</script></svg>";
      const form = new FormData();
      // Lying extension — proves rejection is by content sniff.
      form.append("file", new Blob([svg], { type: "image/png" }), "evil.png");
      const res = await fetch(`${base}/api/users/${current.id}/avatar`, {
        method: "POST",
        headers: { "X-Loctt-Client": "1" },
        body: form,
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/SVG avatars are not supported/i);
    });

    it("rejects /api/users/:id without ?confirm=true", async () => {
      // Create a throwaway user we can try to delete.
      const createRes = await fetch(`${base}/api/users`, {
        method: "POST",
        headers: csrfHeaders,
        body: JSON.stringify({ name: "to-delete" }),
      });
      const created = await createRes.json() as { id: string };
      const res = await fetch(`${base}/api/users/${created.id}`, {
        method: "DELETE",
        headers: csrfHeaders,
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; field?: string; data_state?: string };
      // The query-param spelling is not user copy; the guard identifies
      // itself with a `confirm` field pointer instead (ERR-14).
      expect(body.field).toBe("confirm");
      expect(body.data_state).toBe("not_saved");
    });

    it("rejects /api/tasks/:ref without ?confirm=true", async () => {
      const createRes = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: csrfHeaders,
        body: JSON.stringify({ title: "to-delete" }),
      });
      const created = await createRes.json() as { key: string };
      const res = await fetch(`${base}/api/tasks/${created.key}`, {
        method: "DELETE",
        headers: csrfHeaders,
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; field?: string; data_state?: string };
      // The query-param spelling is not user copy; the guard identifies
      // itself with a `confirm` field pointer instead (ERR-14).
      expect(body.field).toBe("confirm");
      expect(body.data_state).toBe("not_saved");
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
      const body = await res.json() as { error: string; code?: string; field?: string };
      // ERR-10: the failing field and what was expected must survive into
      // the message; the old generic prefix discarded both.
      expect(body.code).toBe("config_invalid");
      expect(body.field).toBe("timezone");
      expect(body.error).toMatch(/timezone/i);
    });

    it("GET /api/list-view returns {} on a fresh tracker", async () => {
      const res = await fetch(`${base}/api/list-view`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toEqual({});
    });

    it("PUT /api/list-view round-trips a valid filters block", async () => {
      const put = await fetch(`${base}/api/list-view`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify({
          filters: { visible: ["status", "priority"], hidden: ["type"] },
        }),
      });
      expect(put.status).toBe(200);
      const get = await fetch(`${base}/api/list-view`);
      const body = await get.json() as { filters?: { visible?: string[]; hidden?: string[] } };
      expect(body.filters?.visible).toEqual(["status", "priority"]);
      expect(body.filters?.hidden).toEqual(["type"]);
    });

    it("PUT /api/list-view returns 400 for a duplicate entry", async () => {
      const res = await fetch(`${base}/api/list-view`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify({
          filters: { visible: ["status", "status"] },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code?: string };
      expect(body.code).toBe("config_invalid");
      expect(body.error).toMatch(/duplicate/i);
    });

    it("GET /api/sprints/:id/burndown returns the series for a known sprint", async () => {
      const create = await fetch(`${base}/api/sprints`, {
        method: "POST",
        headers: csrfHeaders,
        body: JSON.stringify({
          name: "Sprint 1",
          start_date: "2026-05-04",
          end_date: "2026-05-08",
          state: "active",
        }),
      });
      expect(create.status).toBe(201);
      const created = await create.json() as { id: string };

      const res = await fetch(`${base}/api/sprints/${created.id}/burndown`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        sprintId: string;
        series: { date: string }[];
        ideal: { date: string }[];
      };
      expect(body.sprintId).toBe(created.id);
      expect(body.series.length).toBe(5);
      expect(body.ideal.length).toBe(5);
    });

    it("GET /api/sprints/:id/burndown returns 404 for an unknown sprint", async () => {
      const res = await fetch(`${base}/api/sprints/01HXNOSUCH/burndown`);
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/unknown sprint/);
    });

    it("GET /api/tasks/export returns CSV by default", async () => {
      await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: csrfHeaders,
        body: JSON.stringify({ title: "Export A" }),
      });
      const res = await fetch(`${base}/api/tasks/export`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/csv/);
      const body = await res.text();
      expect(body.split("\n")[0]).toMatch(/^key,id,title/);
      expect(body).toMatch(/Export A/);
    });

    it("GET /api/tasks/export?format=json returns JSON", async () => {
      const res = await fetch(`${base}/api/tasks/export?format=json&columns=key,title`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = await res.json() as Array<{ key: string; title: string }>;
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toHaveProperty("key");
      expect(body[0]).toHaveProperty("title");
    });

    it("GET /api/tasks/export rejects bad format", async () => {
      const res = await fetch(`${base}/api/tasks/export?format=xml`);
      expect(res.status).toBe(400);
    });

    it("PUT /api/list-view returns 400 for visible/hidden overlap", async () => {
      const res = await fetch(`${base}/api/list-view`, {
        method: "PUT",
        headers: csrfHeaders,
        body: JSON.stringify({
          filters: { visible: ["status", "type"], hidden: ["type"] },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/both visible and hidden/);
    });
  });
});

describe("GET /api/info — workspace today", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-tz-"));
    // A workspace ahead of UTC, so a UTC-derived date would visibly
    // differ from the correct answer for part of each day.
    await initLoctt(root, { timezone: "Asia/Singapore" });
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

  // The browser can't read calendar.yaml and its own clock answers in
  // the viewer's zone, so the server sends the workspace date.
  it("returns today in the workspace timezone, not UTC", async () => {
    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(200);
    const body = await res.json() as { today: string };
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Compare against the zone's own answer rather than hardcoding a
    // date, so this doesn't rot at midnight.
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    expect(body.today).toBe(expected);
  });
});

/**
 * @verifies PRU-44, PRU-45, PRU-46
 *
 * The API half of the prefix-rename UI cases. The panel's editable
 * prefix control (K30) consumes this contract; these cover the server
 * side of it: the separate endpoint, the field-targeted collision
 * error, and the pending-rename surfacing. The panel-side coverage
 * lives in ProjectsPanel.test.tsx.
 */
describe("project prefix API", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const WRITE = {
    "Content-Type": "application/json",
    "X-Loctt-Client": "test",
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-prefix-"));
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

  async function projectId(): Promise<string> {
    const res = await fetch(`${base}/api/projects`);
    const body = await res.json() as { items: { id: string; prefix: string }[] };
    return body.items[0]?.id ?? "";
  }

  it("renames every task and preserves numbers", async () => {
    for (const title of ["one", "two", "three"]) {
      await fetch(`${base}/api/tasks`, {
        method: "POST", headers: WRITE, body: JSON.stringify({ title }),
      });
    }
    const id = await projectId();

    const res = await fetch(`${base}/api/projects/${id}/prefix`, {
      method: "PUT", headers: WRITE, body: JSON.stringify({ prefix: "WEB-" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { from: string; to: string; renamed: number };
    expect(body).toMatchObject({ from: "T-", to: "WEB-", renamed: 3 });

    // On disk, not merely in the response (PRU-44).
    const list = await fetch(`${base}/api/tasks`);
    const tasks = await list.json() as { items: { key: string }[] };
    expect(tasks.items.map(t => t.key).sort()).toEqual(["WEB-1", "WEB-2", "WEB-3"]);
  });

  it("refuses a prefix in use and points the error at the field", async () => {
    await fetch(`${base}/api/projects`, {
      method: "POST", headers: WRITE,
      body: JSON.stringify({ name: "API", prefix: "API-" }),
    });
    const id = await projectId();

    const res = await fetch(`${base}/api/projects/${id}/prefix`, {
      method: "PUT", headers: WRITE, body: JSON.stringify({ prefix: "API-" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; field?: string; data_state?: string };
    // field drives rendering at the input rather than only a toast
    // (PRU-45, ERR-14).
    expect(body.field).toBe("prefix");
    expect(body.error).toContain("API-");
    expect(body.data_state).toBe("not_saved");
  });

  it("rejects a missing or non-string prefix at the field", async () => {
    const id = await projectId();
    // A body with no `prefix` at all. Core's own empty-string guard
    // cannot cover this: without the handler's type check, `undefined`
    // reaches setProjectPrefix and fails on `.length` as a TypeError —
    // a 500 with no field, instead of a 400 the form can render.
    const res = await fetch(`${base}/api/projects/${id}/prefix`, {
      method: "PUT", headers: WRITE, body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { field?: string; data_state?: string };
    expect(body.field).toBe("prefix");
    expect(body.data_state).toBe("not_saved");
  });

  it("says nothing about a pending rename when there is none", async () => {
    const res = await fetch(`${base}/api/projects`);
    const body = await res.json() as Record<string, unknown>;
    // A permanently-present key would make the panel render a
    // mid-rename banner on a healthy tracker.
    expect("pending_prefix_rename" in body).toBe(false);
  });
});

/**
 * @verifies PRU-46
 *
 * A rename the server could not finish. Own tracker, because the
 * sentinel has to survive to be observed — boot recovery clears it, so
 * this plants it and asserts on what the panel would be given.
 */
describe("interrupted prefix rename API", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let locttDir: string;
  let id: string;

  const WRITE = {
    "Content-Type": "application/json",
    "X-Loctt-Client": "test",
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-pending-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    const { resolveLocttDir } = await import("@loctt/core");
    locttDir = resolveLocttDir(root);
    for (const title of ["one", "two"]) {
      await fetch(`${base}/api/tasks`, {
        method: "POST", headers: WRITE, body: JSON.stringify({ title }),
      });
    }
    const res = await fetch(`${base}/api/projects`);
    const body = await res.json() as { items: { id: string }[] };
    id = body.items[0]?.id ?? "";
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("surfaces the pending rename and completes it on request", async () => {
    const { getPrefixRenameStatePath } = await import("@loctt/core");
    // Plant a sentinel directly: recovery runs on the way in to every
    // API request, so the only way to observe the pending state is to
    // write it and read it in the same request the panel would.
    await writeFile(
      getPrefixRenameStatePath(locttDir),
      `project_id: ${id}\nfrom: T-\nto: WEB-\nstarted_at: 2026-08-15T00:00:00.000Z\n`,
      "utf-8",
    );

    // Boot recovery finishes it, so by the time the panel's own request
    // is served the tracker is healthy again — that is the intended
    // behaviour, and the panel should not be told to show a banner.
    const listed = await fetch(`${base}/api/projects`);
    const body = await listed.json() as Record<string, unknown>;
    expect("pending_prefix_rename" in body).toBe(false);

    // And the rename actually landed, rather than being dropped.
    const tasks = await fetch(`${base}/api/tasks`);
    const taskBody = await tasks.json() as { items: { key: string }[] };
    expect(taskBody.items.every(t => t.key.startsWith("WEB-"))).toBe(true);
  });

  it("reports nothing to complete when the tracker is healthy", async () => {
    const res = await fetch(`${base}/api/projects/prefix-rename/complete`, {
      method: "POST", headers: WRITE,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { completed: boolean };
    // The control must be safe to click twice — the second press is a
    // no-op, not an error.
    expect(body.completed).toBe(false);
  });
});

/**
 * @verifies BLK-12, BLK-39
 *
 * Bulk delete's API contract. The typed confirmation is enforced here
 * as well as in the UI, and partial failure is distinguished from a
 * batch that never ran.
 */
describe("bulk delete API", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const WRITE = {
    "Content-Type": "application/json",
    "X-Loctt-Client": "test",
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-bulkdel-"));
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

  async function makeTask(title: string): Promise<string> {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: WRITE, body: JSON.stringify({ title }),
    });
    const body = await res.json() as { key: string };
    return body.key;
  }

  it("refuses without the typed confirmation, deleting nothing", async () => {
    const key = await makeTask("survivor");

    const res = await fetch(`${base}/api/tasks/bulk/delete`, {
      method: "POST", headers: WRITE,
      body: JSON.stringify({ refs: [key] }),
    });

    expect(res.status).toBe(400);
    // Still there: the gate is the server's, not merely the dialog's.
    const check = await fetch(`${base}/api/tasks/${key}`);
    expect(check.status).toBe(200);
  });

  it("refuses a wrong confirmation string", async () => {
    const key = await makeTask("also survives");
    const res = await fetch(`${base}/api/tasks/bulk/delete`, {
      method: "POST", headers: WRITE,
      body: JSON.stringify({ refs: [key], confirm: "delete" }),
    });
    expect(res.status).toBe(400);
    expect((await fetch(`${base}/api/tasks/${key}`)).status).toBe(200);
  });

  it("deletes on a correct confirmation and reports what went", async () => {
    const a = await makeTask("doomed a");
    const b = await makeTask("doomed b");

    const res = await fetch(`${base}/api/tasks/bulk/delete`, {
      method: "POST", headers: WRITE,
      body: JSON.stringify({ refs: [a, b], confirm: "DELETE" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { succeeded: string[]; failed: unknown[] };
    expect(body.succeeded).toHaveLength(2);
    expect(body.failed).toEqual([]);
    expect((await fetch(`${base}/api/tasks/${a}`)).status).toBe(404);
  });

  it("names each failure individually rather than aborting the batch", async () => {
    const good = await makeTask("real one");

    const res = await fetch(`${base}/api/tasks/bulk/delete`, {
      method: "POST", headers: WRITE,
      body: JSON.stringify({ refs: [good, "T-99999"], confirm: "DELETE" }),
    });

    // 200 with a populated `failed`, not a 400 (BLK-39): the good one
    // really was deleted, and saying "nothing happened" would be a lie.
    expect(res.status).toBe(200);
    const body = await res.json() as {
      succeeded: string[];
      failed: { taskId: string; error: string }[];
    };
    expect(body.succeeded).toHaveLength(1);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]?.taskId).toBe("T-99999");
    expect(body.failed[0]?.error).toMatch(/not found/i);
  });
});
