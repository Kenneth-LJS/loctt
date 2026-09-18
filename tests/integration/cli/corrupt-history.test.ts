import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies CMT-C7
 *
 * `readHistory` coerced anything that was not an array to `[]`, so a
 * `_history.yaml` holding a YAML map read as empty — and the next append
 * overwrote the file with a single fresh entry. The original content was
 * gone, and nothing had said anything was wrong.
 */
describe("a corrupt history file is reported, not silently emptied", () => {
  const historyPath = async (root: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    const [id] = (await readdir(dir)).sort();
    return path.join(dir, id ?? "", "_history.yaml");
  };

  it("reports a non-array history instead of printing 'No history entries'", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      await writeFile(await historyPath(root), "not: an array\nbut: a map\n", "utf-8");

      const res = await runCli(["log", "T-1"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      expect(res.exitCode).not.toBe(0);
      expect(out).not.toMatch(/No history entries/);
      // Naming the file is the difference between "something is wrong"
      // and knowing which file to open.
      expect(out).toMatch(/_history\.yaml/);
    });
  });

  it("does not overwrite the malformed file on the next write", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      const file = await historyPath(root);
      const corrupt = "not: an array\nbut: a map\n";
      await writeFile(file, corrupt, "utf-8");

      // The write may fail or succeed, but it must not destroy the
      // evidence — silently replacing it is the data loss.
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });

      expect(await readFile(file, "utf-8")).toContain("but: a map");
    });
  });

  it("still reads a well-formed history", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a"], { cwd: root });
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });

      const res = await runCli(["log", "T-1"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toMatch(/priority/);
    });
  });
});
