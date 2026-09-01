import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt config usage` — the CLI half of core's
 * `computeWorkflowKeyCounts`, which the web settings panels reach
 * through `GET /api/workflow/usage` and MCP through
 * `get_workflow_key_usage`.
 *
 * The question it answers is the one a user asks immediately before
 * editing `workflow.yaml`: deleting a status that nine tasks hold is a
 * different decision from deleting one nothing references.
 */
describe("CLI config usage (spawned binary)", () => {
  it("reports task counts per workflow key, not merely which keys exist", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "b", "--status", "in_progress"], { cwd: root });
      await runCli(["create", "c"], { cwd: root });

      const result = await runCli(["config", "usage"], { cwd: root });

      expect(result.exitCode).toBe(0);
      // The number, which is the whole point — a presence-only report
      // would say "in_progress" with no count and leave the user to
      // grep the tasks themselves.
      expect(result.stdout).toMatch(/in_progress = 2/);
      expect(result.stdout).toMatch(/backlog = 1/);
      // Every collection is reported, so an empty one is visibly empty
      // rather than absent.
      for (const section of ["statuses", "priorities", "task_types", "relationships", "custom_fields"]) {
        expect(result.stdout).toContain(section);
      }
    });
  });

  it("says a collection is unreferenced rather than printing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      const result = await runCli(["config", "usage"], { cwd: root });

      expect(result.exitCode).toBe(0);
      // A blank section reads as truncated output; "(none referenced)"
      // is an answer.
      expect(result.stdout).toContain("(none referenced)");
    });
  });

  it("is listed in --help, so it is discoverable", async () => {
    await withTmpLoctt(async ({ root }) => {
      const help = await runCli(["--help"], { cwd: root });
      expect(help.stdout + help.stderr).toContain("config usage");
    });
  });
});
