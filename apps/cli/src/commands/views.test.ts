import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, loadQueriesConfig, resolveLocttDir } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "./views.js";

/**
 * @verifies K102 CLI parity for the ordered `filters[]` list —
 * "a capability in core is not done until CLI and MCP have it".
 *
 * A saved view no longer stores a `query` DSL string or a derived
 * `conditions` tree (that premise is deleted by K102). It stores an
 * ORDERED `filters[]` array: `--filter` authors a SIMPLE filter (no query
 * text at all — it stays editable as dropdown rows in the web picker),
 * `--query` authors an ADVANCED filter (raw DSL), and the two are
 * REPEATABLE and interleave in the order typed. These tests prove the CLI
 * actually reaches core's `createView` with that shape, in that order,
 * and that a garbage `--query` is rejected rather than stored.
 */
describe("CLI saved-view conditions parity", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-views-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("create --filter stores a simple filter carrying no query key", async () => {
    await run(["views", "create", "open-work", "--filter", "status = backlog,in_progress"], root);

    const config = await loadQueriesConfig(resolveLocttDir(root));
    const view = config.queries.find(q => q.name === "open-work");
    expect(view).toBeDefined();

    expect(view!.filters).toEqual([
      { kind: "simple", field: "status", op: "=", values: ["backlog", "in_progress"] },
    ]);
    // A simple filter carries no query text at all.
    expect(view!.filters[0]).not.toHaveProperty("query");
  });

  it("create --query stores an advanced filter with the spacing-normalized DSL", async () => {
    await run(["views", "create", "membership", "--query", "status in (backlog, in_progress)"], root);

    const config = await loadQueriesConfig(resolveLocttDir(root));
    const view = config.queries.find(q => q.name === "membership");
    expect(view).toBeDefined();

    expect(view!.filters).toEqual([
      { kind: "advanced", query: "status in (backlog, in_progress)" },
    ]);
  });

  it("mixed --filter/--query/--filter stores exactly three filters, kinds in argv order", async () => {
    await run([
      "views", "create", "mixed",
      "--filter", "status = backlog",
      "--query", "priority = high",
      "--filter", "assignee is empty",
    ], root);

    const config = await loadQueriesConfig(resolveLocttDir(root));
    const view = config.queries.find(q => q.name === "mixed");
    expect(view).toBeDefined();

    expect(view!.filters).toHaveLength(3);
    expect(view!.filters.map(f => f.kind)).toEqual(["simple", "advanced", "simple"]);
    expect(view!.filters).toEqual([
      { kind: "simple", field: "status", op: "=", values: ["backlog"] },
      { kind: "advanced", query: "priority = high" },
      { kind: "simple", field: "assignee", op: "is empty", values: [] },
    ]);
  });

  it("rejects an unparseable --query (no view written)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await run(["views", "create", "junk", "--query", "status = ("], root);

    // A parse failure exits non-zero and writes nothing to the catalog.
    expect(process.exitCode).not.toBe(0);
    process.exitCode = 0;
    expect(errSpy).toHaveBeenCalled();

    const config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.queries.find(q => q.name === "junk")).toBeUndefined();
  });
});
