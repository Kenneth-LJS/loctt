import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CURRENT_SCHEMA_VERSION,
  initLoctt,
  resolveLocttDir,
  writeSchemaVersion,
} from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

describe("POST /api/migrate", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-migrate-"));
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

  const csrfHeaders = {
    "Content-Type": "application/json",
    "X-Loctt-Client": "test",
  };

  it("requires the CSRF header (POST endpoint)", async () => {
    const res = await fetch(`${base}/api/migrate`, { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns a no-op MigrationResult when the tracker is already current", async () => {
    const res = await fetch(`${base}/api/migrate`, {
      method: "POST",
      headers: csrfHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      from: number;
      to: number;
      steps: unknown[];
    };
    expect(body.from).toBe(CURRENT_SCHEMA_VERSION);
    expect(body.to).toBe(CURRENT_SCHEMA_VERSION);
    expect(body.steps).toEqual([]);
  });

  it("ignores a JSON body — no body required", async () => {
    const res = await fetch(`${base}/api/migrate`, {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ ignored: true }),
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/migrate against an outdated tracker", () => {
  // Mirrors the T0.5 review fixture: force the tracker back to
  // v(current-1), then migrate via the API and confirm the schema
  // status flips to current. Only runs when there's a prior version
  // we can downgrade to.
  const target = CURRENT_SCHEMA_VERSION - 1;
  const runner = target >= 1 ? describe : describe.skip;

  runner("end-to-end migrate flow", () => {
    let root: string;
    let app: ReturnType<typeof createWebApp>;
    let base: string;

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "loctt-web-migrate-out-"));
      await initLoctt(root);
      await writeSchemaVersion(resolveLocttDir(root), target);
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

    it("info reports outdated, then migrate brings it to current", async () => {
      const before = await fetch(`${base}/api/info`);
      expect(before.status).toBe(200);
      const bb = await before.json() as { schemaStatus: { kind: string } };
      expect(bb.schemaStatus.kind).toBe("outdated");

      const mig = await fetch(`${base}/api/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      });
      expect(mig.status).toBe(200);
      const mb = await mig.json() as { from: number; to: number; steps: unknown[] };
      expect(mb.from).toBe(target);
      expect(mb.to).toBe(CURRENT_SCHEMA_VERSION);
      expect(mb.steps.length).toBeGreaterThan(0);

      const after = await fetch(`${base}/api/info`);
      const ab = await after.json() as { schemaStatus: { kind: string } };
      expect(ab.schemaStatus.kind).toBe("current");
    });
  });
});

describe("POST /api/migrate against a future-version tracker", () => {
  // Separate root so we can rewrite the schema sentinel without
  // affecting the no-op suite above. Sets the on-disk version to
  // current+1 so the server should refuse with 400.
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-migrate-future-"));
    await initLoctt(root);
    await writeSchemaVersion(resolveLocttDir(root), CURRENT_SCHEMA_VERSION + 1);
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

  it("returns 400 when the tracker is from a newer LocTT", async () => {
    const res = await fetch(`${base}/api/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/version/i);
  });
});
