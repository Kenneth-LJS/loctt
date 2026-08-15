import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MigrateResponse, MigrationPlanResponse } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Migration over HTTP (C1).
 *
 * Was CLI-only: the schema banner told the user to go run `loctt
 * migrate` in a terminal — the one remedy the UI could not offer for
 * the state it was reporting.
 */
describe("migration endpoints", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-migrate-"));
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

  const versionPath = () => join(locttDir, ".schema-version");

  it("reports an empty plan when already current", async () => {
    const res = await fetch(`${base}/api/migrate/plan`);
    expect(res.status).toBe(200);
    const plan = (await res.json()) as MigrationPlanResponse;
    expect(plan.from).toBe(plan.to);
    expect(plan.steps).toEqual([]);
  });

  it("reports 409, not 500, when no migration path exists", async () => {
    // CURRENT_SCHEMA_VERSION is 1 and no migrations are registered, so
    // any other recorded version is unreachable. That is a "migration
    // cannot help you" answer, not a server fault — the same code the
    // schema guard returns for a mismatch.
    await writeFile(versionPath(), "0\n");
    const res = await fetch(`${base}/api/migrate/plan`);
    expect(res.status).toBe(409);
    expect((await res.json() as { error?: string }).error ?? "").toMatch(/migration path|schema/i);
  });

  it("reports 409 when .schema-version is missing entirely", async () => {
    // A damaged tracker, not an old one: migration is not the remedy
    // and the endpoint must say so rather than half-running.
    await rm(versionPath());
    expect((await fetch(`${base}/api/migrate/plan`)).status).toBe(409);
    expect((await fetch(`${base}/api/migrate`, { method: "POST", headers: csrf })).status).toBe(409);
  });

  it("POST is a no-op when already current, and reports no backup", async () => {
    // No steps ran, so there is nothing to roll back to.
    const res = await fetch(`${base}/api/migrate`, { method: "POST", headers: csrf });
    expect(res.status).toBe(200);
    const result = (await res.json()) as MigrateResponse;
    expect(result.steps).toEqual([]);
    expect(result.backupPath).toBeUndefined();
    expect(result.from).toBe(result.to);
  });

  it("migration routes are exempt from the schema guard", async () => {
    // The point of C1: an outdated tracker must be able to migrate
    // itself. Gating migration behind the mismatch it fixes would make
    // the tracker unfixable from this surface.
    //
    // HONEST LIMIT OF THIS TEST. At CURRENT_SCHEMA_VERSION === 1 the
    // exemption is not observable end-to-end: every version the guard
    // rejects is one migration also refuses, with the same error, so
    // removing the exemption from server.ts does NOT fail this test.
    // What is asserted here is the weaker, still-useful fact that the
    // routes answer from their own handler on a healthy tracker.
    //
    // When a v2 lands, replace this with the real case: set the version
    // to 1, assert /api/tasks is 409 while POST /api/migrate returns
    // 200 and migrates. That version WILL fail if the exemption is
    // removed. Until then the exemption is covered by the route table
    // and by this comment, not by an executing assertion.
    const guardBlocks = await fetch(`${base}/api/tasks`);
    expect(guardBlocks.status).toBe(200); // healthy tracker

    const ok = await fetch(`${base}/api/migrate`, { method: "POST", headers: csrf });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as MigrateResponse).steps).toEqual([]);
  });

  it("refuses with 409 when the tracker is newer than this build", async () => {
    await writeFile(versionPath(), "9999\n");
    expect((await fetch(`${base}/api/migrate/plan`)).status).toBe(409);
    const res = await fetch(`${base}/api/migrate`, { method: "POST", headers: csrf });
    expect(res.status).toBe(409);
    // Unchanged — a newer schema cannot be downgraded.
    expect((await readFile(versionPath(), "utf8")).trim()).toBe("9999");
  });
});
