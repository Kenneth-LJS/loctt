import { readdir,readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CMT-C6
 *
 * The rank paths wrote frontmatter with no appendHistory call, and
 * HistoryKind had no value covering a rank change — so a card moved
 * across a board left no audit trail at all. Every other mutating
 * operation records one.
 */
describe("rank changes are recorded in history", () => {
  const historyOf = async (root: string, key: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    for (const id of await readdir(dir)) {
      const task = await readFile(path.join(dir, id, "task.md"), "utf-8");
      if (new RegExp(`^key: ${key}$`, "m").test(task)) {
        return readFile(path.join(dir, id, "_history.yaml"), "utf-8").catch(() => "");
      }
    }
    return "";
  };

  it("records a board reorder", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });

      const res = await runCli(["board-rerank", "T-1", "--after", "T-2"], { cwd: root });
      expect(res.exitCode).toBe(0);

      const history = await historyOf(root, "T-1");
      expect(history).toMatch(/rank/);
    });
  });

  it("records a relationship reorder", async () => {
    await withTmpLoctt(async ({ root }) => {
      for (const t of ["parent", "a", "b"]) {
        await runCli(["create", t], { cwd: root });
      }
      await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
      await runCli(["link", "T-1", "blocks", "T-3"], { cwd: root });

      const res = await runCli(
        ["rerank", "T-1", "blocks", "T-3", "--before", "T-2"], { cwd: root },
      );
      expect(res.exitCode, `${res.stdout}${res.stderr}`).toBe(0);

      const history = await historyOf(root, "T-1");
      expect(history).toMatch(/rank/);
    });
  });

  it("names the actor, like every other entry", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "first"], { cwd: root });
      await runCli(["create", "second"], { cwd: root });
      await runCli(["board-rerank", "T-1", "--after", "T-2"], { cwd: root });

      // An audit trail that cannot say who moved the card is not one.
      expect(await historyOf(root, "T-1")).toMatch(/actor:/);
    });
  });
});
