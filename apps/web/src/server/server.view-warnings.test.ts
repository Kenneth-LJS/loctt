import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * VUE-21: a saved view referencing a deleted custom field must degrade
 * **visibly** — "it does not return zero rows presented as a
 * legitimate empty result".
 *
 * `listTasks` has always raised this through `onWarning` rather than
 * throwing, because a view that used to work must keep working. The
 * web server was not passing the callback, so the warning was raised
 * in core and dropped, and the response was an ordinary 200 with an
 * empty list. These tests pin the warning reaching the response.
 */
describe("a saved view whose custom field no longer exists", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const QUERIES = `queries:
  - id: 01J0000000000000000000001
    name: ghostfield
    query: fields.squad = platform
  - id: 01J0000000000000000000003
    name: healthy
    query: status = backlog
`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-warn-"));
    await initLoctt(root);
    // `squad` is deliberately absent from workflow.yaml — the view
    // outlived the field, which is the case's premise.
    await writeFile(join(root, ".loctt/config/queries.yaml"), QUERIES);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const view = async (name: string) =>
    (await (await fetch(`${base}/api/tasks?view=${name}`)).json()) as {
      items: unknown[];
      warnings?: { message: string; field: string }[];
    };

  // @verifies VUE-21
  it("surfaces a warning naming the unknown field rather than an empty result", async () => {
    const body = await view("ghostfield");

    // The view still runs — breaking it would regress a tracker that
    // used to work, which is why core warns instead of throwing.
    expect(Array.isArray(body.items)).toBe(true);

    // The load-bearing half: the response says *why* the set is empty,
    // and names the field.
    expect(body.warnings).toBeDefined();
    expect(body.warnings?.length ?? 0).toBeGreaterThan(0);
    expect(body.warnings?.[0]?.message ?? "").toContain("squad");
    expect(body.warnings?.[0]?.field).toBe("query");
  });

  // @verifies VUE-21
  it("leaves other saved views working and unwarned", async () => {
    // The case's last bullet, and the positive control for the test
    // above: a warning on every response would satisfy "a warning is
    // present" while telling the user nothing.
    const healthy = await view("healthy");
    expect(healthy.warnings).toBeUndefined();
  });

  // @verifies VUE-21
  // @verifies DEG-22
  it("keeps the broken view listed and editable rather than dropping it", async () => {
    // "The sidebar entry is not silently removed; the view remains
    // editable so the user can fix it."
    const listed = (await (await fetch(`${base}/api/views`)).json()) as {
      queries: { name: string; query: string }[];
    };
    const entry = listed.queries.find(q => q.name === "ghostfield");
    expect(entry).toBeDefined();
    // Its query comes back verbatim, so the editor can pre-populate it.
    expect(entry?.query).toBe("fields.squad = platform");
  });
});
