import { describe, expect, it } from "vitest";

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
  it("create then list shows the view; edit changes it", async () => {
    await withTmpLoctt(async ({ root }) => {
      const create = await runCli(
        ["views", "create", "open-work", "--query", "status = backlog"],
        { cwd: root },
      );
      expect(create.exitCode).toBe(0);
      expect(create.stdout).toContain("Created view");

      const list = await runCli(["views"], { cwd: root });
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("open-work");
      expect(list.stdout).toContain("status = backlog");

      const edit = await runCli(
        ["views", "edit", "open-work", "--name", "renamed", "--query", "status = done"],
        { cwd: root },
      );
      expect(edit.exitCode).toBe(0);

      const after = await runCli(["views"], { cwd: root });
      expect(after.stdout).toContain("renamed");
      expect(after.stdout).toContain("status = done");
      expect(after.stdout).not.toContain("open-work");
    });
  });

  it("stores and renders a multi-key sort", async () => {
    await withTmpLoctt(async ({ root }) => {
      const create = await runCli(
        ["views", "create", "sorted", "--query", "status = backlog", "--sort", "priority:desc,created:asc"],
        { cwd: root },
      );
      expect(create.exitCode).toBe(0);

      const list = await runCli(["views"], { cwd: root });
      expect(list.stdout).toContain("[sort: priority desc, created asc]");
    });
  });

  it("rejects a malformed query on create with a usage/runtime error, writing nothing", async () => {
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
      await runCli(["views", "create", "v", "--query", "status = backlog"], { cwd: root });

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
      await runCli(["views", "create", "doomed", "--query", "status = backlog"], { cwd: root });

      const del = await runCli(["views", "delete", "doomed", "--yes"], { cwd: root });
      expect(del.exitCode).toBe(0);
      expect(del.stdout).toContain("Deleted view");

      const list = await runCli(["views"], { cwd: root });
      expect(list.stdout).not.toContain("doomed");

      const missing = await runCli(["views", "delete"], { cwd: root });
      expect(missing.exitCode).toBe(2);
    });
  });

  it("rejects an unknown flag rather than silently ignoring it", async () => {
    await withTmpLoctt(async ({ root }) => {
      const res = await runCli(
        ["views", "create", "x", "--query", "status = backlog", "--bogus", "y"],
        { cwd: root },
      );
      expect(res.exitCode).toBe(2);
      expect(res.stderr).toMatch(/unknown option --bogus/);
    });
  });
});
