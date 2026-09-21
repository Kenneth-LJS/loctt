import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * K102: a saved view stores an ORDERED `filters` array — a discriminated
 * union of `{ kind: "simple", field, op, values }` and
 * `{ kind: "advanced", query }` entries. There is no derived `query`
 * string and no `conditions` BuilderTree any more; the filter list is the
 * sole source of truth and round-trips as authored (order, kind, and
 * per-kind shape all preserved).
 *
 * This replaces the old `server.view-conditions.test.ts`, whose whole
 * premise — a structured `conditions` tree that core derived a `query`
 * string from — was the pre-K102 model. There is no equivalent
 * "derives the query from it" test any more: K102 deliberately removed
 * the derived canonical DSL, so nothing reconstructs one to assert
 * against.
 */
describe("POST/PUT /api/views with an ordered filters list", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-vfilt-"));
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

  it("creates a view from a simple filter and round-trips it with no query key", async () => {
    const filters = [
      { kind: "simple", field: "status", op: "in", values: ["backlog"] },
    ];
    const res = await fetch(`${base}/api/views`, {
      method: "POST", headers: csrf, body: JSON.stringify({ name: "from-filters", filters }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { filters: { kind: string; query?: string }[] };
    expect(created.filters).toEqual(filters);
    // A simple filter carries no `query` key at all — the union is
    // discriminated, not one shape with an optional field.
    expect(created.filters[0]?.query).toBeUndefined();

    // It round-trips to disk, and reloads with the same structure.
    const listed = (await (await fetch(`${base}/api/views`)).json()) as {
      queries: { name: string; filters: { kind: string }[] }[];
    };
    const entry = listed.queries.find(q => q.name === "from-filters");
    expect(entry?.filters).toEqual(filters);
  });

  it("creates a view from an advanced filter and round-trips its DSL verbatim (modulo whitespace)", async () => {
    const res = await fetch(`${base}/api/views`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({
        name: "from-advanced",
        filters: [{ kind: "advanced", query: "status = backlog" }],
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { filters: { kind: string; query: string }[] };
    expect(created.filters).toEqual([{ kind: "advanced", query: "status = backlog" }]);

    const yaml = await readFile(join(locttDir, "config/queries.yaml"), "utf8");
    expect(yaml).toContain("kind: advanced");
    expect(yaml).toContain("query: status = backlog");
  });

  it("preserves the authored order of a mixed filter list, in both kinds", async () => {
    const filters = [
      { kind: "advanced", query: "priority = high" },
      { kind: "simple", field: "status", op: "!=", values: ["done"] },
      { kind: "advanced", query: "assignee = currentUser()" },
    ];
    const res = await fetch(`${base}/api/views`, {
      method: "POST", headers: csrf, body: JSON.stringify({ name: "mixed", filters }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { filters: { kind: string }[] };
    // Order and kind survive exactly — a set-like write or a
    // kind-normalizing one would both fail this.
    expect(created.filters.map(f => f.kind)).toEqual(["advanced", "simple", "advanced"]);
    expect(created.filters).toEqual(filters);

    const listed = (await (await fetch(`${base}/api/views`)).json()) as {
      queries: { name: string; filters: { kind: string }[] }[];
    };
    const entry = listed.queries.find(q => q.name === "mixed");
    expect(entry?.filters).toEqual(filters);
  });

  it("edits a view's filter list, replacing it wholesale", async () => {
    const created = (await (await fetch(`${base}/api/views`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({
        name: "editable",
        filters: [{ kind: "advanced", query: "status = backlog" }],
      }),
    })).json()) as { id: string };

    const nextFilters = [
      { kind: "simple", field: "status", op: "=", values: ["done"] },
    ];
    const res = await fetch(`${base}/api/views/${created.id}`, {
      method: "PUT", headers: csrf, body: JSON.stringify({ filters: nextFilters }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { filters: unknown[] };
    expect(updated.filters).toEqual(nextFilters);
  });

  it("leaves the filter list untouched when an edit omits it", async () => {
    const filters = [{ kind: "simple", field: "status", op: "=", values: ["backlog"] }];
    const created = (await (await fetch(`${base}/api/views`, {
      method: "POST", headers: csrf, body: JSON.stringify({ name: "unedited", filters }),
    })).json()) as { id: string };

    const res = await fetch(`${base}/api/views/${created.id}`, {
      method: "PUT", headers: csrf, body: JSON.stringify({ name: "renamed-only" }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { name: string; filters: unknown[] };
    expect(updated.name).toBe("renamed-only");
    expect(updated.filters).toEqual(filters);
  });
});
