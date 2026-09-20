import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * A saved view that vanished from `queries.yaml` under a live tab.
 *
 * XS-28 is explicit that this must not error: "the list falls back to
 * a defined default view and says so — it does not render an error
 * page or an empty table implying zero tasks". Resolving the ref in
 * core throws `ViewError`, which the list handler's catch turns into a
 * 400, so the drop has to happen before core sees it.
 *
 * @verifies XS-28
 */
describe("GET /api/tasks with a deleted saved view", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const headers = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-missingview-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "a task" }),
    });
    // A queries.yaml with one view that is *not* the one asked for.
    await writeFile(
      join(root, ".loctt", "config", "queries.yaml"),
      // `conditions` is now required (Stage 1); it is the structured
      // form of the same `status.category = active` DSL.
      "queries:\n"
      + "  - id: v_live\n"
      + "    name: Live view\n"
      + "    query: 'status.category = active'\n"
      + "    conditions:\n"
      + "      kind: leaf\n"
      + "      field: status.category\n"
      + "      op: '='\n"
      + "      value:\n"
      + "        type: string\n"
      + "        value: active\n",
      "utf8",
    );
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("falls back to the unfiltered list and names the view it dropped", async () => {
    const res = await fetch(`${base}/api/tasks?view=v_deleted`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      items: unknown[];
      total: number;
      missing_view?: string;
    };
    // Not an error page, and not an empty table implying zero tasks.
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBeGreaterThan(0);
    // And the fallback is reported rather than performed silently.
    expect(body.missing_view).toBe("v_deleted");
  });

  it("leaves a view that still exists alone", async () => {
    const res = await fetch(`${base}/api/tasks?view=v_live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { missing_view?: string };
    expect(body.missing_view).toBeUndefined();
  });
});
