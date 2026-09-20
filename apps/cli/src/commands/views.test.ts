import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt, loadQueriesConfig, resolveLocttDir } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "./views.js";

/**
 * @verifies Stage-3 CLI parity for structured saved-view conditions —
 * "a capability in core is not done until CLI and MCP have it".
 *
 * A view created through the CLI (DSL-in via `--query`) must land in
 * queries.yaml with a populated structured `conditions` tree, exactly as
 * a web-authored view does, because the stored schema requires it and all
 * three surfaces must produce the same shape. The CLI passes the raw DSL
 * to core's `createView`, which derives+validates the conditions; these
 * tests prove that path is actually reached and that a garbage DSL is
 * rejected rather than stored.
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

  it("create --query stores a populated membership `conditions` tree and round-trips the query", async () => {
    await run(["views", "create", "open-work", "--query", "status in (backlog, in_progress)"], root);

    const config = await loadQueriesConfig(resolveLocttDir(root));
    const view = config.queries.find(q => q.name === "open-work");
    expect(view).toBeDefined();

    // The parity requirement: conditions is populated and structured (a
    // membership leaf), not merely a query string. This is the assertion
    // the red-proof breaks.
    expect(view!.conditions).toEqual({
      kind: "leaf",
      field: "status",
      op: "in",
      value: {
        type: "list",
        values: [
          { type: "string", value: "backlog" },
          { type: "string", value: "in_progress" },
        ],
      },
    });

    // The stored `query` is the spacing-normalized regeneration of the
    // membership form — `in (...)`, not `= a` — so the DSL round-trips.
    expect(view!.query).toBe("status in (backlog, in_progress)");
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
