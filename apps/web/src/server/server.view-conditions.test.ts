import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Stage 2: the create/edit view routes accept STRUCTURED `conditions`
 * (a BuilderTree) in the body and pass it to core, which derives the DSL
 * `query` from it. A client that still sends only `query` (defensive)
 * keeps working — core derives conditions. These pin both directions.
 */
describe("POST/PUT /api/views with structured conditions", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-vcond-"));
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

  it("creates a view from conditions and derives the query from it", async () => {
    const conditions = {
      kind: "group",
      op: "and",
      children: [
        { kind: "leaf", field: "status", op: "in", value: { type: "list", values: [{ type: "string", value: "backlog" }] } },
      ],
    };
    const res = await fetch(`${base}/api/views`, {
      method: "POST", headers: csrf, body: JSON.stringify({ name: "from-conditions", conditions }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { conditions?: { kind: string }; query: string };
    // The stored view carries the structured conditions AND a derived
    // query that agrees with them (membership, not `=`).
    expect(created.conditions?.kind).toBe("group");
    expect(created.query).toContain("status in (backlog)");

    // It round-trips to disk, and reloads with the same structure.
    const listed = (await (await fetch(`${base}/api/views`)).json()) as {
      queries: { name: string; conditions?: { kind: string }; query: string }[];
    };
    const entry = listed.queries.find(q => q.name === "from-conditions");
    expect(entry?.conditions?.kind).toBe("group");
    expect(entry?.query).toContain("status in (backlog)");
  });

  it("keeps the query-only (defensive) path working — core derives conditions", async () => {
    const res = await fetch(`${base}/api/views`, {
      method: "POST", headers: csrf, body: JSON.stringify({ name: "from-query", query: "status = backlog" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { conditions?: { kind: string } };
    // Even though the client sent no conditions, core derived and stored them.
    expect(created.conditions).toBeDefined();
    const yaml = await readFile(join(locttDir, "config/queries.yaml"), "utf8");
    expect(yaml).toContain("conditions:");
  });

  it("edits a view's filter via conditions", async () => {
    const created = (await (await fetch(`${base}/api/views`, {
      method: "POST", headers: csrf, body: JSON.stringify({ name: "editable", query: "status = backlog" }),
    })).json()) as { id: string };

    const nextConditions = {
      kind: "leaf", field: "status", op: "=", value: { type: "string", value: "done" },
    };
    const res = await fetch(`${base}/api/views/${created.id}`, {
      method: "PUT", headers: csrf, body: JSON.stringify({ conditions: nextConditions }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { query: string };
    expect(updated.query).toContain("status = done");
  });
});
