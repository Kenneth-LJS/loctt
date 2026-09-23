import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeTool } from "../index.js";

/**
 * @verifies UI-9 (MCP surface).
 *
 * A saved view's advanced filter can be SHAPE-valid — `{kind: "advanced",
 * query: <any string>}` satisfies `FilterSchema` — while its DSL does not
 * parse. `parseQueriesConfig` only checks shape, so this entry loads as
 * an ordinary healthy `SavedQuery`, and the DSL is only parsed when the
 * view actually runs, via `filtersToNode` in `query/list.ts`.
 *
 * Before this fix, `list_tasks` with such a view threw an unclassified
 * `FilterError` that `isKnownDomainError` did not list, so the
 * dispatcher's outer catch (`index.ts`) rethrew it instead of returning
 * an `errorResult` — an agent got an opaque server fault with no way to
 * learn the view's DSL does not parse. `isKnownDomainError` now lists
 * `FilterError` alongside `ViewError` (which the view WRITE path — the
 * sibling case in `views.test.ts`, "create_view rejects a malformed
 * advanced filter" — already covers).
 */
describe("list_tasks with a broken saved view (UI-9)", () => {
  let root: string;
  const VIEW_ID = "01UNPARSE0000000000000000B";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-brokenview-"));
    await initLoctt(root);
    await writeFile(
      join(root, ".loctt/config/queries.yaml"),
      "queries:\n"
      + `  - id: ${VIEW_ID}\n`
      + "    name: Broken view\n"
      + "    filters:\n"
      + "      - kind: advanced\n"
      + "        query: \"status = = = done AND\"\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns an actionable errorResult naming the parse fault, not a rethrown server fault", async () => {
    const result = await executeTool(root, "list_tasks", { view: VIEW_ID });
    expect(result.isError).toBe(true);
    const msg = result.content[0]?.text ?? "";
    // The parse fault must survive to the agent. A296 moved the
    // detection to LOAD time, which made core's resolver report
    // `unknown view` — true of the lookup, wrong for the agent, who
    // would go hunting for the right id instead of repairing the DSL.
    expect(msg).toContain(
      "advanced filter does not parse: expected value but got \"=\" at position 9",
    );
    expect(msg).not.toContain("unknown view");
  });

  it("still runs an unrelated ordinary call", async () => {
    const result = await executeTool(root, "list_tasks", {});
    expect(result.isError).toBeUndefined();
  });
});
