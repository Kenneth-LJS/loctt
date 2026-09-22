import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt set T-1,T-2 <field> <value>` (CW-4).
 *
 * Core had bulkSetFields and no surface reached it, so changing one
 * field across several tasks meant N commands and N history entries
 * that no consumer could group.
 */
describe("CLI bulk set (spawned binary)", () => {
  async function seed(root: string, n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      await runCli(["create", `task ${i + 1}`], { cwd: root });
    }
  }

  it("sets a field across several tasks in one command", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 3);
      const r = await runCli(["set", "T-1,T-2", "status", "in_progress"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");

      // Assert the far end on each task, not the summary line.
      for (const key of ["T-1", "T-2"]) {
        const show = await runCli(["show", key], { cwd: root });
        expect(show.stdout).toContain("in_progress");
      }
      const untouched = await runCli(["show", "T-3"], { cwd: root });
      expect(untouched.stdout).toContain("backlog");
    });
  });

  it("keeps the single-ref path and its friendlier message", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 1);
      const r = await runCli(["set", "T-1", "status", "done"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("on T-1");
    });
  });

  it("reports per-task failures and exits non-zero", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 1);
      const r = await runCli(["set", "T-1,T-404", "status", "done"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("T-404");
      // The good ref still landed — a bad ref does not abort the batch.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toContain("done");
    });
  });

  it("clears a field across several tasks via unset", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 2);
      await runCli(["set", "T-1,T-2", "priority", "high"], { cwd: root });
      const r = await runCli(["unset", "T-1,T-2", "priority"], { cwd: root });
      expect(r.exitCode).toBe(0);

      for (const key of ["T-1", "T-2"]) {
        const show = await runCli(["show", key], { cwd: root });
        expect(show.stdout).not.toContain("high");
      }
    });
  });

  it("tolerates a trailing comma", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 2);
      const r = await runCli(["set", "T-1,T-2,", "status", "done"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");
    });
  });
});

/**
 * `loctt archive T-1,T-2` / `loctt delete T-1,T-2 --yes` /
 * `loctt link T-1,T-2 <rel> T-3` (bulk archive/delete/link parity).
 *
 * Core had bulkArchive/bulkDelete/bulkLink and only the web reached
 * them; the CLI archive/delete/link were single-ref. Each test below
 * was red-proven against the pre-change single-ref command: `archive`
 * and `link` looked up only args[1]/args[3] and silently ignored the
 * rest of a comma list; `delete` looked up one ref. See the report's
 * red-proof notes.
 */
describe("CLI bulk archive/delete/link (spawned binary)", () => {
  async function seed(root: string, n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      await runCli(["create", `task ${i + 1}`], { cwd: root });
    }
  }

  it("archives several tasks in one command", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 3);
      const r = await runCli(["archive", "T-1,T-2"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");

      // Both are actually archived (show prints "Archived:"), T-3 is not.
      for (const key of ["T-1", "T-2"]) {
        const show = await runCli(["show", key], { cwd: root });
        expect(show.stdout).toContain("Archived:");
      }
      const untouched = await runCli(["show", "T-3"], { cwd: root });
      expect(untouched.stdout).not.toContain("Archived:");
    });
  });

  it("keeps the single-ref archive path and its friendlier message", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 1);
      const r = await runCli(["archive", "T-1"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Archived T-1");
    });
  });

  it("counts already-archived tasks as unchanged in a mixed selection", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 2);
      await runCli(["archive", "T-1"], { cwd: root });
      const r = await runCli(["archive", "T-1,T-2"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");
      expect(r.stdout).toContain("1 already in that state");
    });
  });

  it("unarchives several tasks in one command", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 2);
      await runCli(["archive", "T-1,T-2"], { cwd: root });
      const r = await runCli(["unarchive", "T-1,T-2"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");
      for (const key of ["T-1", "T-2"]) {
        const show = await runCli(["show", key], { cwd: root });
        expect(show.stdout).not.toContain("Archived:");
      }
    });
  });

  it("reports a bad ref on bulk archive without aborting the rest", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 1);
      const r = await runCli(["archive", "T-1,T-404"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("T-404");
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toContain("Archived:");
    });
  });

  it("deletes several tasks in one command with --yes", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 3);
      const r = await runCli(["delete", "T-1,T-2", "--yes"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");

      // Both gone, T-3 survives.
      for (const key of ["T-1", "T-2"]) {
        const show = await runCli(["show", key], { cwd: root });
        expect(show.exitCode).not.toBe(0);
      }
      const survivor = await runCli(["show", "T-3"], { cwd: root });
      expect(survivor.exitCode).toBe(0);
    });
  });

  it("refuses bulk delete without --yes in non-interactive mode", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 2);
      const r = await runCli(["delete", "T-1,T-2"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      // Nothing was deleted — the confirm gate fired before core.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).toBe(0);
    });
  });

  it("reports a bad ref on bulk delete without aborting the rest", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 1);
      const r = await runCli(["delete", "T-1,T-404", "--yes"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("T-404");
      // The good ref still went.
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.exitCode).not.toBe(0);
    });
  });

  it("links several sources to one target in one command", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 3);
      const r = await runCli(["link", "T-1,T-2", "blocks", "T-3"], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("2 task(s)");

      // Each source now has the edge to T-3.
      for (const key of ["T-1", "T-2"]) {
        const show = await runCli(["show", key], { cwd: root });
        expect(show.stdout).toContain("T-3");
      }
    });
  });

  it("reports a bad source on bulk link without aborting the rest", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seed(root, 2);
      const r = await runCli(["link", "T-1,T-404", "blocks", "T-2"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("T-404");
      const show = await runCli(["show", "T-1"], { cwd: root });
      expect(show.stdout).toContain("T-2");
    });
  });
});
