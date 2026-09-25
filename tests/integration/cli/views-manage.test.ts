import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies K30 F2 — saved-view management on the CLI.
 *
 * Before this build `loctt views` was a read-only lister; a view could
 * only be authored in the web UI or by hand-editing queries.yaml. These
 * exercise the new create/edit/archive/unarchive/delete subcommands
 * through the spawned binary, the same path a user runs.
 */
describe("CLI views management (spawned binary)", () => {
  it("create with a simple --filter then list shows it; edit changes it", async () => {
    await withTmpLoctt(async ({ root }) => {
      // K102: `--filter "field op value"` authors a SIMPLE filter, the
      // preferred CLI path — a view made here renders as dropdown rows in
      // the web picker rather than as opaque DSL.
      const create = await runCli(
        ["views", "create", "open-work", "--filter", "status = backlog"],
        { cwd: root },
      );
      expect(create.exitCode).toBe(0);
      expect(create.stdout).toContain("Created view");

      const list = await runCli(["views"], { cwd: root });
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("open-work");
      // The listed summary is rendered from the filters at display time.
      expect(list.stdout).toContain("status = backlog");

      const edit = await runCli(
        ["views", "edit", "open-work", "--name", "renamed", "--filter", "status = done"],
        { cwd: root },
      );
      expect(edit.exitCode).toBe(0);

      const after = await runCli(["views"], { cwd: root });
      expect(after.stdout).toContain("renamed");
      expect(after.stdout).toContain("status = done");
      expect(after.stdout).not.toContain("open-work");
    });
  });

  it("stores simple and advanced filters together, in the order typed (K102)", async () => {
    await withTmpLoctt(async ({ root }) => {
      // The load-bearing K102 guarantee: filters are stored AS AUTHORED —
      // mixed kinds, in argv order, never merged into one DSL string.
      const create = await runCli(
        [
          "views", "create", "mixed",
          "--filter", "status = backlog",
          "--query", 'has_link("is_blocked_by")',
          "--filter", "priority = high",
        ],
        { cwd: root },
      );
      expect(create.exitCode).toBe(0);

      const raw = await readFile(
        path.join(root, ".loctt/config/queries.yaml"),
        "utf8",
      );
      const parsed = parseYaml(raw) as {
        queries: { name: string; filters: { kind: string }[] }[];
      };
      const view = parsed.queries.find(q => q.name === "mixed");
      expect(view).toBeDefined();
      // Three filters, each keeping its own kind, in the authored order.
      expect(view?.filters.map(f => f.kind)).toEqual(["simple", "advanced", "simple"]);
      // The simple ones carry NO query string — that is what makes them
      // render back as dropdown rows rather than as DSL text.
      expect(view?.filters[0]).not.toHaveProperty("query");
      expect(view?.filters[2]).not.toHaveProperty("query");
    });
  });

  it("normalises an advanced filter's spacing and nothing else", async () => {
    await withTmpLoctt(async ({ root }) => {
      // Ken: "you may normalise spacing, dont edit anything else."
      const create = await runCli(
        ["views", "create", "spaced", "--query", "status=backlog"],
        { cwd: root },
      );
      expect(create.exitCode).toBe(0);

      const raw = await readFile(
        path.join(root, ".loctt/config/queries.yaml"),
        "utf8",
      );
      const parsed = parseYaml(raw) as {
        queries: { name: string; filters: { kind: string; query?: string }[] }[];
      };
      const view = parsed.queries.find(q => q.name === "spaced");
      expect(view?.filters[0]?.query).toBe("status = backlog");
    });
  });

  it("stores and renders a multi-key sort", async () => {
    await withTmpLoctt(async ({ root }) => {
      const create = await runCli(
        ["views", "create", "sorted", "--filter", "status = backlog", "--sort", "priority:desc,created:asc"],
        { cwd: root },
      );
      expect(create.exitCode).toBe(0);

      const list = await runCli(["views"], { cwd: root });
      expect(list.stdout).toContain("[sort: priority desc, created asc]");
    });
  });

  it("rejects a malformed advanced query on create with a usage/runtime error, writing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const create = await runCli(
        ["views", "create", "broken", "--query", "status = = ="],
        { cwd: root },
      );
      expect(create.exitCode).not.toBe(0);

      const list = await runCli(["views"], { cwd: root });
      expect(list.stdout).not.toContain("broken");
    });
  });

  it("archive hides it by default; --archived all shows it with a marker; unarchive restores (K107)", async () => {
    // K107 changed the default: a plain `views` list now HIDES archived
    // views (scope active). The archived view is reachable via
    // `--archived all` (or `--archived archived`), where it carries the
    // marker. This replaces the pre-K107 assertion that a plain list showed
    // the archived view inline.
    await withTmpLoctt(async ({ root }) => {
      await runCli(["views", "create", "v", "--filter", "status = backlog"], { cwd: root });

      const arch = await runCli(["views", "archive", "v"], { cwd: root });
      expect(arch.exitCode).toBe(0);
      // Default scope hides the archived view entirely.
      let list = await runCli(["views"], { cwd: root });
      expect(list.stdout).not.toMatch(/v\b.*\(archived\)/);
      // Showing all reveals it, with the archived marker.
      const all = await runCli(["views", "--archived", "all"], { cwd: root });
      expect(all.stdout).toMatch(/v\b.*\(archived\)/);

      const un = await runCli(["views", "unarchive", "v"], { cwd: root });
      expect(un.exitCode).toBe(0);
      list = await runCli(["views"], { cwd: root });
      expect(list.stdout).toContain("v  status = backlog");
      expect(list.stdout).not.toMatch(/v\b.*\(archived\)/);
    });
  });

  it("delete removes the view with --yes; a missing ref is a usage error", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["views", "create", "doomed", "--filter", "status = backlog"], { cwd: root });

      const del = await runCli(["views", "delete", "doomed", "--yes"], { cwd: root });
      expect(del.exitCode).toBe(0);
      expect(del.stdout).toContain("Deleted view");

      const list = await runCli(["views"], { cwd: root });
      expect(list.stdout).not.toContain("doomed");

      const missing = await runCli(["views", "delete"], { cwd: root });
      expect(missing.exitCode).toBe(2);
    });
  });

  /**
   * @verifies VUE-42
   *
   * K102-broken-repair. A hand-broken entry could not be repaired OR
   * deleted by any surface — `findView` never looked in `config.broken`,
   * so every write threw `unknown view: <id>`. The UI offered
   * "Edit…/Replace…/Delete…" on those rows and all of them were dead.
   *
   * These pin the whole gate through the spawned binary: refused without
   * `--force` with the original bytes intact, repaired with it keeping
   * the SAME id, and — the regression guard for Ken's constraint 4 —
   * `--force` alone on a HEALTHY view stays a usage error rather than
   * becoming a back door to an empty edit.
   */
  it("refuses to replace a broken view without --force, leaving its text byte-identical", async () => {
    await withTmpLoctt(async ({ root }) => {
      const cfg = path.join(root, ".loctt/config/queries.yaml");
      await writeFile(
        cfg,
        `${await readFile(cfg, "utf8")}  - id: 01M0BROKENINTEG0000000001\n    name: brokenone\n    filters: "not a list"\n`,
        "utf8",
      );
      const before = await readFile(cfg, "utf8");

      const res = await runCli(
        ["views", "edit", "brokenone", "--filter", "status = done"],
        { cwd: root },
      );
      expect(res.exitCode).not.toBe(0);
      // The message must be actionable — not a bare `unknown view: <ulid>`.
      const text = `${res.stdout}${res.stderr}`;
      expect(text).toMatch(/is broken/);
      expect(text).toMatch(/--force/);
      // And the preserved text is untouched.
      expect(await readFile(cfg, "utf8")).toBe(before);
    });
  });

  it("repairs a broken view with --force, keeping the same id", async () => {
    await withTmpLoctt(async ({ root }) => {
      const cfg = path.join(root, ".loctt/config/queries.yaml");
      await writeFile(
        cfg,
        `${await readFile(cfg, "utf8")}  - id: 01M0BROKENINTEG0000000002\n    name: fixme\n    filters: "not a list"\n`,
        "utf8",
      );

      const res = await runCli(
        ["views", "edit", "fixme", "--filter", "status = done", "--force"],
        { cwd: root },
      );
      expect(res.exitCode).toBe(0);
      // The SAME id survives, so a pin or bookmark still resolves.
      expect(res.stdout).toContain("01M0BROKENINTEG0000000002");

      const list = await runCli(["views"], { cwd: root });
      expect(list.stdout).toContain("fixme  status = done");
    });
  });

  it("--force alone on a HEALTHY view is still a usage error, not a no-op rewrite", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["views", "create", "healthy", "--filter", "status = backlog"], { cwd: root });

      const res = await runCli(["views", "edit", "healthy", "--force"], { cwd: root });
      expect(res.exitCode).toBe(2);
      expect(`${res.stdout}${res.stderr}`).toMatch(/nothing to change/);
    });
  });

  it("rejects an unknown flag rather than silently ignoring it", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(
        ["views", "create", "x", "--filter", "status = backlog", "--bogus", "y"],
        { cwd: root },
      );
      expect(res.exitCode).toBe(2);
      expect(res.stderr).toMatch(/unknown option --bogus/);
    });
  });

  // B21 (K129): "if you save a view, and the name already matches, then
  // we should just error." Core refuses; the CLI reports it and exits 1.
  // @verifies VUE-20
  it("refuses a view name another view has, on create and on rename, writing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const queriesPath = path.join(root, ".loctt/config/queries.yaml");
      expect((await runCli(["views", "create", "Overdue", "--filter", "status = backlog"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["views", "create", "mine", "--filter", "status = done"], { cwd: root })).exitCode).toBe(0);
      const before = await readFile(queriesPath, "utf8");

      const create = await runCli(["views", "create", " overdue ", "--filter", "status = done"], { cwd: root });
      expect(create.exitCode).toBe(1);
      expect(create.stderr).toContain("Another view with that name already exists.");

      const rename = await runCli(["views", "edit", "mine", "--name", "OVERDUE"], { cwd: root });
      expect(rename.exitCode).toBe(1);
      expect(rename.stderr).toContain("Another view with that name already exists.");

      expect(await readFile(queriesPath, "utf8")).toBe(before);
    });
  });

  // @verifies VUE-20
  it("views already sharing a name on disk still list; --view <name> refuses the ambiguity", async () => {
    await withTmpLoctt(async ({ root }) => {
      const entry = (id: string): string =>
        `  - id: ${id}\n    name: dup\n    filters:\n      - kind: simple\n        field: status\n        op: "="\n        values: ["backlog"]\n`;
      await writeFile(
        path.join(root, ".loctt/config/queries.yaml"),
        `queries:\n${entry("01DUPA0000000000000000000A")}${entry("01DUPB0000000000000000000B")}`,
        "utf8",
      );
      const list = await runCli(["views"], { cwd: root });
      expect(list.exitCode).toBe(0);
      expect(list.stdout.match(/^dup /gm)).toHaveLength(2);

      const byName = await runCli(["list", "--view", "dup"], { cwd: root });
      expect(byName.exitCode).not.toBe(0);
      expect(byName.stderr).toMatch(/multiple views named 'dup'/i);

      const byId = await runCli(["list", "--view", "01DUPA0000000000000000000A"], { cwd: root });
      expect(byId.exitCode).toBe(0);
    });
  });
});
