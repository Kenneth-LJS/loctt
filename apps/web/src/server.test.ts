import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
