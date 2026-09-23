import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `GET /api/tasks` — the M1.2 sort/pagination surface. Backed by a
 * real tracker (the existing convention in this suite); core's own
 * sort/query logic is tested in packages/core, so these assert the
 * route maps `?sort=&dir=` correctly, validates `dir`, and paginates.
 */
describe("GET /api/tasks (sort + pagination)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-tasks-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    for (const title of ["Apple", "Cherry", "Banana"]) {
      await fetch(`${base}/api/tasks`, { method: "POST", headers: csrf, body: JSON.stringify({ title }) });
    }
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function list(qs: string): Promise<{ items: TaskFrontmatterPublic[]; total: number }> {
    const res = await fetch(`${base}/api/tasks?${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()) as { items: TaskFrontmatterPublic[]; total: number };
  }

  it("sorts ascending by a field", async () => {
    const { items } = await list("sort=title&dir=asc");
    expect(items.map(t => t.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("sorts descending by a field", async () => {
    const { items } = await list("sort=title&dir=desc");
    expect(items.map(t => t.title)).toEqual(["Cherry", "Banana", "Apple"]);
  });

  it("defaults dir to ascending when only sort is given", async () => {
    const { items } = await list("sort=title");
    expect(items.map(t => t.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("rejects an invalid dir with 400", async () => {
    const res = await fetch(`${base}/api/tasks?sort=title&dir=sideways`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("dir");
  });

  it("reports the full total independent of the page slice", async () => {
    const { items, total } = await list("sort=title&dir=asc&limit=2&offset=0");
    expect(items).toHaveLength(2);
    expect(total).toBe(3);
  });

  it("applies a structured status filter (single value)", async () => {
    // Set one task's status so a status filter narrows the set. The
    // default workflow's first status is the create-time default; move
    // "Cherry" to a different status, then filter to it.
    const all = await list("sort=title&dir=asc");
    const cherry = all.items.find(t => t.title === "Cherry");
    const otherStatus = (await (await fetch(`${base}/api/workflow`)).json() as {
      statuses: { key: string }[];
    }).statuses.find(s => s.key !== cherry?.status)?.key;
    expect(otherStatus).toBeDefined();
    await fetch(`${base}/api/tasks/${cherry!.key}/set`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ field: "status", value: otherStatus }),
    });

    const filtered = await list(`status=${otherStatus}`);
    expect(filtered.items.map(t => t.title)).toEqual(["Cherry"]);
  });

  it("filters on a comma-separated multi-value param (B8)", async () => {
    // The single-value path above is what every existing test used, and
    // it builds `status = x`. Two or more values build a list, which
    // was emitted as `status in [a, b]` — a form the tokenizer has no
    // `[` token for, so this returned 500 rather than filtering.
    // Own fixtures: these tests share one tracker, so relying on what
    // sibling cases leave behind makes this pass or fail on file order.
    const workflow = await (await fetch(`${base}/api/workflow`)).json() as {
      statuses: { key: string }[];
    };
    const [s1, s2] = workflow.statuses.map(s => s.key) as [string, string];
    expect(s2).toBeDefined();

    const made: string[] = [];
    for (const [title, status] of [["B8-one", s1], ["B8-two", s2], ["B8-three", s1]] as const) {
      const res = await fetch(`${base}/api/tasks`, {
        method: "POST", headers: csrf, body: JSON.stringify({ title }),
      });
      const { key } = await res.json() as { key: string };
      made.push(title);
      await fetch(`${base}/api/tasks/${key}/set`, {
        method: "POST", headers: csrf, body: JSON.stringify({ field: "status", value: status }),
      });
    }

    // Each value alone selects a strict subset, so a multi-value query
    // matching everything cannot pass by accident.
    const onlyS2 = await list(`status=${s2}&sort=title&dir=asc`);
    expect(onlyS2.items.map(t => t.title)).toContain("B8-two");
    expect(onlyS2.items.map(t => t.title)).not.toContain("B8-one");

    const both = await list(`status=${s1},${s2}&sort=title&dir=asc`);
    const titles = both.items.map(t => t.title);
    for (const title of made) expect(titles).toContain(title);
  });

  // Fix 1 (server dslAtom under-quoting): the server used to build its
  // filter atoms with a plain regex that let a bare keyword/number/date
  // through UNQUOTED, so it re-tokenized as the wrong type or as invalid
  // DSL. It now imports core's tokenizer-checked dslAtom, which quotes
  // such values so they round-trip to one plain STRING token.
  //
  // Red-proof: under the old regex `labels=and` emitted `labels = and`,
  // where `and` is the AND keyword — invalid DSL, which the list route
  // maps to 400. Quoted (`labels = "and"`) it is a valid query that
  // matches nothing, i.e. 200 with an empty set.
  it("quotes a keyword-shaped filter value so the query stays valid (Fix 1)", async () => {
    const res = await fetch(`${base}/api/tasks?labels=and`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: TaskFrontmatterPublic[] };
    // No task carries a label literally named "and", so the set is empty
    // — but the request is valid, not a 400 parse error.
    expect(body.items.map(t => t.title)).not.toContain("Apple");
  });

  it("quotes other keyword-shaped filter values (Fix 1)", async () => {
    // `or`/`in`/`is` are DSL operators/keywords: emitted bare they make
    // `labels = or` etc., which is invalid DSL (the old regex passed them
    // through, giving a 400). Quoted, each is a valid string comparison.
    for (const value of ["or", "in", "is"]) {
      const res = await fetch(`${base}/api/tasks?labels=${value}`);
      expect(res.status, `labels=${value}`).toBe(200);
    }
  });

  // K107: the tri-state `?archived` scope replaces the old `?archived=true`
  // boolean. `active` (default) hides archived; `all` includes them;
  // `archived` returns only archived. (This test asserted the old boolean
  // spelling `archived=true`.)
  it("excludes archived tasks by default, includes them with archived=all / archived", async () => {
    const all = await list("sort=title&dir=asc");
    const apple = all.items.find(t => t.title === "Apple");
    await fetch(`${base}/api/tasks/${apple!.key}/archive`, { method: "POST", headers: csrf });

    const visible = await list("");
    expect(visible.items.map(t => t.title)).not.toContain("Apple");

    const withAll = await list("archived=all");
    expect(withAll.items.map(t => t.title)).toContain("Apple");

    const onlyArchived = await list("archived=archived");
    expect(onlyArchived.items.map(t => t.title)).toContain("Apple");
    // `archived` is ONLY archived — an active task must not appear.
    const banana = all.items.find(t => t.title === "Banana");
    if (banana !== undefined) {
      expect(onlyArchived.items.map(t => t.title)).not.toContain("Banana");
    }

    // A stale `?archived=true` bookmark is no longer recognised and falls
    // back to the default active scope — archived stays hidden.
    const legacyBool = await list("archived=true");
    expect(legacyBool.items.map(t => t.title)).not.toContain("Apple");
  });

  // K121 #1: a query naming `archived` would override the scope (K107's
  // term-wins rule) and reveal archived tasks through a URL parameter.
  // The web list refuses it instead, naming where archived tasks live.
  // @verifies SET-52
  it("refuses a list query that names the archived field", async () => {
    for (const q of ["archived = true", "status = backlog and archived = true", "not archived = false"]) {
      const res = await fetch(`${base}/api/tasks?query=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(400);
      const body = await res.json() as { code: string; field: string; message: string };
      expect(body.code).toBe("validation_failed");
      expect(body.field).toBe("query");
      expect(body.message).toBe("Archived tasks aren't listed here. Find them in Settings, under Archived.");
    }
    // The word inside a string literal is not the field.
    const res = await fetch(`${base}/api/tasks?query=${encodeURIComponent('title ~ "archived"')}`);
    expect(res.status).toBe(200);
  });

  // K25: idempotent archive/unarchive (behavior recorded in decisions.md K25/A127; no canonical case)
  it("archiving an already-archived task returns 200, not a 500 (K25)", async () => {
    const created = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "Twice" }),
    });
    const task = await created.json() as { key: string };

    const first = await fetch(`${base}/api/tasks/${task.key}/archive`, { method: "POST", headers: csrf });
    expect(first.status).toBe(200);

    // K25: the second archive is an idempotent no-op success. Before it,
    // core threw a plain TaskLifecycleError that the global handler could
    // not classify, so this returned a generic 500 — the B16 fallout
    // TSK-57 names.
    const second = await fetch(`${base}/api/tasks/${task.key}/archive`, { method: "POST", headers: csrf });
    expect(second.status).toBe(200);
    const body = await second.json() as { archived?: boolean };
    expect(body.archived).toBe(true);
  });
});
