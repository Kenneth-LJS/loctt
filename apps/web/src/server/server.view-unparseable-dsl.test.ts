import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies UI-9
 *
 * A saved view's advanced filter can be SHAPE-valid (`{kind: "advanced",
 * query: <any string>}` satisfies `FilterSchema`) while its DSL does not
 * parse. `parseQueriesConfig` only checks shape (`config/queries.ts`
 * `resolveFilters`), so this entry loads as an ordinary healthy
 * `SavedQuery` — it is NOT reported in `queriesConfig.broken`, unlike
 * `server.view-broken-repair.test.ts`'s "not a list" case. The DSL is
 * only ever parsed when the view actually runs, via
 * `filtersToNode` → `advancedToNode` (`packages/core/src/query/filters.ts`).
 *
 * Before this fix, `GET /api/tasks?view=<id>` for such a view threw an
 * unclassified `FilterError` that escaped every catch in
 * `handleListTasks` and fell through to the generic 500 handler:
 *
 *   {"code":"unknown","message":"The server failed while handling GET
 *    /api/tasks.","recovery":{"kind":"retry"},
 *    "detail":"advanced filter does not parse: ..."}
 *
 * — stranding the actionable message in `detail` (which the client does
 * not render) behind a Retry button that can never succeed, since the
 * view will not parse on the next attempt either. `isQueryError` in
 * `server.ts` now lists `FilterError` alongside `TokenizeError`/
 * `ParseError`/`QueryValidationError`/`ViewError`, so it is caught in
 * `handleListTasks`'s existing catch and reported as a 400 naming the
 * real cause with no retry control.
 */
describe("GET /api/tasks?view=<id> — a shape-valid but unparseable advanced filter", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const VIEW_ID = "01UNPARSE0000000000000000A";

  const queriesPath = (): string => join(root, ".loctt/config/queries.yaml");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-vdsl-"));
    await initLoctt(root);
    await writeFile(
      queriesPath(),
      "queries:\n"
      + `  - id: ${VIEW_ID}\n`
      + "    name: Broken view\n"
      + "    filters:\n"
      + "      - kind: advanced\n"
      // Same offending text as the seeded playground tracker's "Broken
      // view" (01M33FP00000000000000000A6), so this test's expected
      // message matches the one recorded in ui-issues.md verbatim.
      + "        query: \"status = = = done AND\"\n",
      "utf8",
    );
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  // A296 CHANGED THIS. The test above used to assert the view was
  // "reported healthy … (the classification gap, tracked separately)" —
  // a green test asserting a defect by name. `parseQueriesConfig` now
  // parses each view's DSL at load, so an unparseable one is classified
  // broken and carries its parse position.
  it("is reported BROKEN by GET /api/views, with the parse position", async () => {
    const res = await fetch(`${base}/api/views`);
    const body = (await res.json()) as {
      queries: { id: string }[];
      broken?: { id: string; error: string; position?: number }[];
    };
    expect(body.queries.some(q => q.id === VIEW_ID)).toBe(false);
    const broken = (body.broken ?? []).find(b => b.id === VIEW_ID);
    expect(broken?.error).toBe(
      "advanced filter does not parse: expected value but got \"=\" at position 9",
    );
    expect(broken?.position).toBe(9);
  });

  // A296 ALSO CHANGED THIS ROUTE. Before it, the view reached the run
  // path and threw there, so the assertion was "a 4xx naming the parse
  // error, not a 500" (UI-9's headline fix). Now it is caught at LOAD,
  // excluded from `queries`, and the request takes the `broken_view`
  // path at `server.ts:4066-4091` — a deliberate non-fatal diagnostic
  // beside the rows, carrying the raw query so the advanced editor can
  // open pre-populated to repair it in place.
  //
  // The user-facing guarantee UI-9 won is unchanged and still asserted:
  // the real parse message reaches the client, rather than "the server
  // failed" with a Retry that could never work.
  it("reports the parse fault as a non-fatal broken_view, not a 500", async () => {
    const res = await fetch(`${base}/api/tasks?view=${VIEW_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      broken_view?: { id: string; error: string; position?: number };
    };
    expect(body.broken_view?.id).toBe(VIEW_ID);
    expect(body.broken_view?.error).toBe(
      "advanced filter does not parse: expected value but got \"=\" at position 9",
    );
    expect(body.broken_view?.position).toBe(9);
  });

  it("still runs an unrelated ordinary request", async () => {
    const res = await fetch(`${base}/api/tasks`);
    expect(res.status).toBe(200);
  });
});
