import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/**
 * @verifies K102-broken-repair on the CLI surface.
 *
 * Core gained the repair path; the ruling makes CLI parity part of the
 * same change, not a follow-up. `--force` is the CLI's spelling of the
 * explicit opt-in. Before this, `loctt views edit <broken>` died on
 * `Error: unknown view: <ref>` with no way through at all.
 */
describe("CLI saved-view broken repair (--force)", () => {
  let root: string;
  const BROKEN_ID = "01BROKEN00000000000000000B";

  /** queries.yaml with one healthy view and one whose filters will not load. */
  async function seedBroken(): Promise<void> {
    await writeFile(
      join(resolveLocttDir(root), "config", "queries.yaml"),
      "queries:\n"
      + "  - id: 01KEEP000000000000000000AA\n"
      + "    name: keep\n"
      + "    filters:\n"
      + "      - kind: simple\n"
      + "        field: status\n"
      + "        op: \"!=\"\n"
      + "        values: [\"done\"]\n"
      + `  - id: ${BROKEN_ID}\n`
      + "    name: broken-one\n"
      + "    filters: \"not a list\"\n",
      "utf-8",
    );
  }

  const bytes = async (): Promise<string> =>
    readFile(join(resolveLocttDir(root), "config", "queries.yaml"), "utf-8");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-views-broken-"));
    await initLoctt(root);
    await seedBroken();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it("edit without --force is refused, names the view, and leaves the file byte-identical", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await bytes();

    await run(["views", "edit", "broken-one", "--filter", "status = done"], root);

    expect(process.exitCode).not.toBe(0);
    const printed = errSpy.mock.calls.flat().join(" ");
    expect(printed).toContain("broken-one");
    expect(printed).toContain("--force");
    expect(printed).not.toContain("unknown view");
    // The outcome that matters: the preserved original text survived.
    expect(await bytes()).toBe(before);
  });

  it("edit --force repairs the view in place, keeping its id", async () => {
    await run(["views", "edit", "broken-one", "--filter", "status = done", "--force"], root);

    const config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.broken).toBeUndefined();
    const repaired = config.queries.find(q => q.id === BROKEN_ID);
    expect(repaired?.name).toBe("broken-one");
    expect(repaired?.filters).toEqual([
      { kind: "simple", field: "status", op: "=", values: ["done"] },
    ]);
    expect(await bytes()).not.toContain("not a list");
  });

  it("delete --yes without --force is refused and the file is byte-identical", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await bytes();

    await run(["views", "delete", "broken-one", "--yes"], root);

    expect(process.exitCode).not.toBe(0);
    expect(errSpy.mock.calls.flat().join(" ")).toContain("--force");
    expect(await bytes()).toBe(before);
  });

  it("delete --yes --force removes the broken entry and keeps the healthy one", async () => {
    await run(["views", "delete", "broken-one", "--yes", "--force"], root);

    const config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.broken).toBeUndefined();
    expect(config.queries.find(q => q.id === BROKEN_ID)).toBeUndefined();
    expect(config.queries.find(q => q.name === "keep")).toBeDefined();
  });

  it("archive on a broken view is refused with a clear message", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await bytes();

    await run(["views", "archive", "broken-one"], root);

    expect(process.exitCode).not.toBe(0);
    expect(errSpy.mock.calls.flat().join(" ")).toContain("cannot be archived");
    expect(await bytes()).toBe(before);
  });

  it("a HEALTHY view still edits and deletes with no flag at all", async () => {
    // Constraint 4: the normal path takes on no new friction because a
    // broken sibling happens to exist in the same file.
    await run(["views", "edit", "keep", "--name", "renamed"], root);
    let config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.queries.find(q => q.name === "renamed")).toBeDefined();
    expect(config.broken).toHaveLength(1);

    await run(["views", "delete", "renamed", "--yes"], root);
    config = await loadQueriesConfig(resolveLocttDir(root));
    expect(config.queries.find(q => q.name === "renamed")).toBeUndefined();
    // And the broken sibling is still preserved, untouched.
    expect(config.broken).toHaveLength(1);
    expect(await bytes()).toContain("not a list");
  });
});

/**
 * @verifies K103 colour on a saved view, CLI half — "a capability in
 * core is not done until CLI and MCP have it".
 *
 * What these catch: a `--color` flag accepted but never threaded to
 * core (so it silently does nothing), and the `-` clear convention
 * diverging from `label edit --color`.
 */
describe("CLI saved-view colour parity", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cli-viewcolor-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("stores all three colour shapes through --color", async () => {
    const locttDir = resolveLocttDir(root);
    await run(["views", "create", "hexed", "--color", "#1e6fcb"], root);
    await run(["views", "create", "palled", "--color", "palette:teal"], root);
    await run(["views", "create", "paired", "--color", "light:#0F766E,dark:#39A88F"], root);

    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries.find(q => q.name === "hexed")?.color).toBe("#1e6fcb");
    expect(cfg.queries.find(q => q.name === "palled")?.color).toEqual({ palette: "teal" });
    expect(cfg.queries.find(q => q.name === "paired")?.color)
      .toEqual({ light: "#0F766E", dark: "#39A88F" });
  });

  it("clears a colour with --color -", async () => {
    const locttDir = resolveLocttDir(root);
    await run(["views", "create", "temp", "--color", "#1e6fcb"], root);
    await run(["views", "edit", "temp", "--color", "-"], root);
    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries.find(q => q.name === "temp")?.color).toBeUndefined();
  });

  it("accepts --color alone as a change on edit", async () => {
    const locttDir = resolveLocttDir(root);
    await run(["views", "create", "solo", "--filter", "status = backlog"], root);
    // `--color` on its own must satisfy the nothing-to-change guard, or
    // setting only a colour is a usage error.
    await run(["views", "edit", "solo", "--color", "palette:blue"], root);
    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries.find(q => q.name === "solo")?.color).toEqual({ palette: "blue" });
  });
});
