import { chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * A delete that does not go through.
 *
 * BLK-45's central claim is about what is left behind: "the task still
 * resolves by key and still appears in the list — there is no
 * directory left behind that reads as an unloadable ghost". A bulk
 * delete reports per-task failures in its 200 body, so the question is
 * whether a reported failure is also a *true* one.
 */
describe("POST /api/tasks/bulk/delete when a delete fails", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const headers = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-delfail-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    // Restore permissions so the cleanup can remove everything.
    const tasksDir = join(root, ".loctt", "tasks");
    try {
      for (const id of await readdir(tasksDir)) {
        await chmod(join(tasksDir, id), 0o755);
      }
      await chmod(tasksDir, 0o755);
    } catch { /* already gone */ }
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function create(title: string): Promise<{ id: string; key: string }> {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title }),
    });
    return res.json() as Promise<{ id: string; key: string }>;
  }

  /**
   * @verifies BLK-45
   *
   * A ref that cannot be resolved fails by name and takes nothing with
   * it. This is the reachable half: forcing `rm` to fail partway needs
   * a filesystem the test cannot portably arrange, but the invariant
   * the case is protecting — a reported failure leaves the tracker
   * exactly as it was — is the same one.
   */
  it("names the task that failed and leaves the others deleted", async () => {
    const keep = await create("Survives");
    const drop = await create("Goes away");

    const res = await fetch(`${base}/api/tasks/bulk/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refs: [drop.key, "T-99999"], confirm: "DELETE" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      succeeded: string[];
      failed: { taskId: string; error: string }[];
    };

    // The failure names the task and the reason.
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]?.taskId).toBe("T-99999");
    expect(body.failed[0]?.error).toMatch(/not found/i);

    // The one that worked is gone, the untouched one is untouched.
    expect(body.succeeded).toEqual([drop.id]);
    const listed = await (await fetch(`${base}/api/tasks`)).json() as {
      items: { key: string }[];
    };
    expect(listed.items.map(t => t.key)).toEqual([keep.key]);
  });

  /**
   * @verifies BLK-45
   *
   * "There is no directory left behind that reads as an unloadable
   * ghost." A delete that fails must not have half-removed the task —
   * the directory is either whole or absent, never a husk the next
   * read chokes on.
   */
  it("leaves a task that could not be deleted whole and resolvable", async () => {
    const victim = await create("Cannot be removed");
    const tasksDir = join(root, ".loctt", "tasks");

    // Make the *parent* read-only, so removing the child directory
    // fails. This is the closest portable stand-in for the case's
    // "attachments directory not removable".
    await chmod(tasksDir, 0o555);

    const res = await fetch(`${base}/api/tasks/bulk/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refs: [victim.key], confirm: "DELETE" }),
    });
    const body = await res.json() as {
      succeeded: string[];
      failed: { taskId: string; error: string }[];
    };

    await chmod(tasksDir, 0o755);

    // Guard the guard: a read-only parent must actually block the
    // removal here, or every assertion below is skipped and this test
    // passes without checking anything. Running as root, or on a
    // filesystem that ignores the mode, would do exactly that.
    expect(
      body.failed.length,
      "expected the read-only parent to block the delete; if this fails "
      + "the environment is not reproducing the case and the test below "
      + "would assert nothing",
    ).toBe(1);

    {
      expect(body.succeeded).toEqual([]);
      expect(body.failed[0]?.taskId).toBe(victim.key);
      expect(body.failed[0]?.error.length).toBeGreaterThan(0);

      // Still resolves by key...
      const one = await fetch(`${base}/api/tasks/${victim.key}`);
      expect(one.status).toBe(200);
      // ...still in the list...
      const listed = await (await fetch(`${base}/api/tasks`)).json() as {
        items: { key: string }[];
      };
      expect(listed.items.map(t => t.key)).toContain(victim.key);
      // ...and the directory is whole, not a husk.
      const dir = await stat(join(tasksDir, victim.id));
      expect(dir.isDirectory()).toBe(true);
      const contents = await readdir(join(tasksDir, victim.id));
      expect(contents).toContain("task.md");
    }
  });
});
