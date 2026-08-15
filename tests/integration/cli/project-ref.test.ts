import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * P-3: "CLI and MCP accept a project name (erroring on ambiguity) or a
 * ULID." `create` and `move` resolve names; `list --project` and
 * `duplicate --project` did not.
 *
 * `list` was the damaging one — it reported "No tasks found." and exited
 * 0 with tasks present, because the raw name reached a query layer that
 * matches on ULID. A real project and a nonexistent one were
 * indistinguishable in both output and exit code.
 */
describe("CLI project references (spawned binary)", () => {
  it("filters the list by project name, not just by id", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });
      await runCli(["create", "web task"], { cwd: root });

      const byName = await runCli(["list", "--project", "Tasks"], { cwd: root });
      expect(byName.exitCode).toBe(0);
      expect(byName.stdout).toContain("web task");
    });
  });

  it("reports an unknown project instead of an empty result", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "web task"], { cwd: root });

      const bogus = await runCli(["list", "--project", "NoSuchProject"], { cwd: root });
      // The failure mode being fixed: exit 0 and "No tasks found.", which
      // is indistinguishable from a real project that happens to be empty.
      expect(bogus.exitCode).not.toBe(0);
      expect(`${bogus.stdout}${bogus.stderr}`).toMatch(/unknown project/i);
    });
  });

  it("duplicates into a project named by name", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["project", "create", "Backend", "--prefix", "B"], { cwd: root });
      await runCli(["create", "original"], { cwd: root });

      const dup = await runCli(["duplicate", "T-1", "--project", "Backend"], { cwd: root });
      expect(dup.exitCode).toBe(0);
      // The old failure leaked an allocator internal rather than resolving.
      expect(`${dup.stdout}${dup.stderr}`).not.toMatch(/key allocation state/);
    });
  });

  it("names the project rather than leaking allocator internals", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "original"], { cwd: root });

      const dup = await runCli(["duplicate", "T-1", "--project", "NoSuchProject"], { cwd: root });
      expect(dup.exitCode).not.toBe(0);
      const out = `${dup.stdout}${dup.stderr}`;
      expect(out).toMatch(/unknown project/i);
      expect(out).not.toMatch(/key allocation state/);
    });
  });
});
