/**
 * `DELETE /api/projects/:id` — delete vs archive.

 * The contract is hard-by-default with `?soft=true` to archive, which
 * is what PRU-17 and PRU-18 require: PRU-17 forbids a default that
 * silently orphans tasks, and PRU-18 speaks of a project that "was
 * hard-deleted" as the ordinary case.
 *
 * The route shipped calling core's `deleteProject` with only `remapTo`
 * and never `hard`, so **every delete silently archived**: core returns
 * early on `hard !== true`, archives, and reports
 * `remappedTaskCount: 0`. Worse, `remapTo` without `hard` *throws*
 * inside core ("--remap-to only applies to --hard delete"), so the one
 * parameter the route did forward was unusable.
 *
 * The API answered 200 either way, so a user who deleted a project
 * still had it — archived, not gone — and no test noticed. All 232
 * server tests and all 19 new settings UI tests passed with the fix
 * reverted; measured, not assumed.
 *
 * These tests assert the far end — the project's absence from the
 * config — rather than the status code, because 200 was exactly what
 * the defect returned.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

describe("DELETE /api/projects/:id", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const headers = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-projdelete-"));
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

  async function listProjects(
    scope: "active" | "archived" | "all" = "active",
  ): Promise<{ id: string; name: string; archived?: boolean }[]> {
    // K107: the list defaults to the `active` scope, so a caller wanting to
    // see archived rows must ask for `all` (or `archived`).
    const res = await fetch(`${base}/api/projects?archived=${scope}`, { headers });
    const body = await res.json() as { items: { id: string; name: string; archived?: boolean }[] };
    return body.items;
  }

  async function makeProject(name: string, prefix: string): Promise<string> {
    const res = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, prefix }),
    });
    expect(res.status).toBe(201);
    const found = (await listProjects()).find(p => p.name === name);
    expect(found, `project ${name} was not created`).toBeDefined();
    return found?.id ?? "";
  }

  it("a plain DELETE removes the project rather than archiving it", async () => {
    const id = await makeProject("Doomed", "DM");

    const res = await fetch(`${base}/api/projects/${id}`, {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(200);

    // The far end. A 200 was what the defect returned too, so the
    // status alone proves nothing: the project must be *gone*.
    const after = await listProjects();
    expect(after.find(p => p.id === id)).toBeUndefined();
  });

  it("?soft=true archives instead, and the project is still listed", async () => {
    const id = await makeProject("Shelved", "SH");

    const res = await fetch(`${base}/api/projects/${id}?soft=true`, {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(200);

    // Archive is a legitimate outcome — it is what the case asks for
    // when `hard` is absent. Asserted so the two paths are told apart:
    // without this, a route that always hard-deleted would also pass
    // the test above. K107: the archived project is now hidden from the
    // DEFAULT (`active`) list, so this lists with `archived=all` to prove
    // it was archived (still in the file) rather than hard-deleted.
    const foundInAll = (await listProjects("all")).find(p => p.id === id);
    expect(foundInAll, "an archived project should still be listed under scope=all").toBeDefined();
    expect(foundInAll?.archived).toBe(true);
    // And it is absent from the default active list — the K107 default.
    expect((await listProjects()).find(p => p.id === id)).toBeUndefined();
  });
});
