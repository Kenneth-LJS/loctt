import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * VUE-35: a failed write to `queries.yaml` must not leave a phantom
 * view — one the sidebar shows but the file does not contain (a direct
 * P1 violation).
 *
 * The failure is induced by making the config **directory**
 * unwritable, not the file. `saveQueriesConfig` writes to a temp file
 * beside the target and renames it, so `chmod 444` on the file alone
 * does not stop the owner from replacing it — measured: the save
 * succeeded with 201 and the view was written. Only the directory
 * permission actually blocks the write, which is what makes this test
 * a real reproduction rather than a no-op that passes for the wrong
 * reason.
 */
describe("a save that queries.yaml refuses", () => {
  let root: string;
  let configDir: string;
  let queriesPath: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-rofail-"));
    await initLoctt(root);
    configDir = join(root, ".loctt/config");
    queriesPath = join(configDir, "queries.yaml");
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    // Restore before cleanup, or rm cannot remove the tree.
    await chmod(configDir, 0o755).catch(() => undefined);
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // @verifies VUE-35
  it("reports the failure, writes nothing, and leaves no phantom view", async () => {
    const before = await readFile(queriesPath, "utf8");
    await chmod(configDir, 0o555);

    const res = await fetch(`${base}/api/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ name: "phantom", query: "status = backlog" }),
    });

    // The save reports failure...
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { code?: string; message?: string };
    // ...naming the file and the reason (the case's first bullet).
    expect(body.message ?? "").toContain("queries.yaml");
    expect(body.message ?? "").toMatch(/permission/i);

    await chmod(configDir, 0o755);

    // Nothing was written.
    expect(await readFile(queriesPath, "utf8")).toBe(before);

    // And no phantom view: the sidebar's source of truth is this
    // endpoint, and it must not list what the file does not hold.
    const listed = await fetch(`${base}/api/views`);
    const views = (await listed.json()) as { queries: { name: string }[] };
    expect(views.queries.map(v => v.name)).not.toContain("phantom");
  });

  // @verifies VUE-35
  it("still writes normally once the permission is restored, so the retry works", async () => {
    // POSITIVE CONTROL. Without this, the assertions above would pass
    // for a server that rejected every save — the test would be
    // asserting a broken endpoint rather than a handled failure.
    await chmod(configDir, 0o555);
    const failed = await fetch(`${base}/api/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ name: "phantom", query: "status = backlog" }),
    });
    expect(failed.status).toBeGreaterThanOrEqual(400);

    await chmod(configDir, 0o755);
    const retried = await fetch(`${base}/api/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ name: "phantom", query: "status = backlog" }),
    });
    expect(retried.status).toBe(201);
    expect(await readFile(queriesPath, "utf8")).toContain("phantom");
  });
});
