import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * VUE-17: a saved view with five sort fields keeps all five, in the
 * authored order, through the write and back.
 *
 * The file is asserted directly rather than the response body: the
 * case's first bullet is about what lands in `queries.yaml`, and a
 * response echoing what it was sent proves nothing about the write.
 */
describe("a saved view with five sort fields", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-vsort-"));
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


  /**
   * The sort fields of one named view. `queries.yaml` ships with
   * default views that carry their own sorts, so a document-wide
   * regex would assert those too — the failure that first showed here.
   */
  const sortFieldsOf = (yaml: string, name: string): string[] => {
    const block = yaml.split(/^  - id:/m).find(b => b.includes(`name: ${name}`)) ?? "";
    return [...block.matchAll(/- field: (\w+)/g)].map(m => m[1] ?? "");
  };

  const FIVE = [
    { field: "priority", direction: "desc" },
    { field: "due_date", direction: "asc" },
    { field: "status", direction: "asc" },
    { field: "title", direction: "asc" },
    { field: "created_at", direction: "desc" },
  ];

  const create = (name: string, sort: unknown) =>
    fetch(`${base}/api/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ name, query: "status = backlog", sort }),
    });

  // @verifies VUE-17
  it("persists all five entries to queries.yaml in the authored order", async () => {
    expect((await create("five", FIVE)).status).toBe(201);

    const yaml = await readFile(join(locttDir, "config/queries.yaml"), "utf8");
    // Order is the assertion, not mere presence: a set-like write that
    // reordered them would still contain all five names.
    expect(sortFieldsOf(yaml, "five")).toEqual(["priority", "due_date", "status", "title", "created_at"]);

    // Directions travel with their fields, not as a separate list.
    expect(yaml).toMatch(/- field: priority\s+direction: desc/);
    expect(yaml).toMatch(/- field: created_at\s+direction: desc/);
    expect(yaml).toMatch(/- field: due_date\s+direction: asc/);
  });

  // @verifies VUE-17
  it("reads the five back in the same order, so a reload reproduces the sort", async () => {
    await create("five", FIVE);
    const res = await fetch(`${base}/api/views`);
    const body = (await res.json()) as { queries: { name: string; sort?: { field: string }[] }[] };
    const view = body.queries.find(q => q.name === "five");
    expect(view?.sort?.map(s => s.field))
      .toEqual(["priority", "due_date", "status", "title", "created_at"]);
  });

  // @verifies VUE-17
  it("writes a reordered sort as the new order, not merged with the old", async () => {
    const created = await create("five", FIVE);
    const { id } = (await created.json()) as { id: string };

    const reordered = [...FIVE].reverse();
    const put = await fetch(`${base}/api/views/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ sort: reordered }),
    });
    expect(put.status).toBe(200);

    const yaml = await readFile(join(locttDir, "config/queries.yaml"), "utf8");
    // Exactly five, in the new order — an append would give ten.
    expect(sortFieldsOf(yaml, "five")).toEqual(["created_at", "title", "status", "due_date", "priority"]);
  });
});
