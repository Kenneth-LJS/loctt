import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies MSL-C1
 *
 * `loctt set T-1 milestone v1` stored the literal string "v1" while the
 * milestone's identity is a ULID. Progress counts by id, so a milestone
 * with tasks reported 0/0 — and the same held for sprints, where the
 * burndown reported an initial total of 0.
 *
 * invariants.md states the rule for sprints — "Tasks reference sprints
 * by id. A sprint's name is mutable and not unique" — and milestones
 * have the identical shape.
 */
describe("entity references are stored as ids, not names", () => {
  const taskFile = async (root: string): Promise<string> => {
    const dir = path.join(root, ".loctt/tasks");
    const { readdir } = await import("node:fs/promises");
    const [id] = (await readdir(dir)).sort();
    return readFile(path.join(dir, id ?? "", "task.md"), "utf-8");
  };

  const idOf = async (root: string, file: string, name: string): Promise<string> => {
    const raw = await readFile(path.join(root, ".loctt/config", file), "utf-8");
    const m = new RegExp(`- id: ([0-9A-HJKMNP-TV-Z]{26})\\n\\s+name: ${name}`).exec(raw);
    return m?.[1] ?? "";
  };

  it("stores a milestone id when set by name", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["milestone", "create", "v1"], { cwd: root });
      await runCli(["create", "a task"], { cwd: root });

      const set = await runCli(["set", "T-1", "milestone", "v1"], { cwd: root });
      expect(set.exitCode).toBe(0);

      const id = await idOf(root, "milestones.yaml", "v1");
      expect(id).not.toBe("");
      expect(await taskFile(root)).toContain(`milestone: ${id}`);
    });
  });

  it("counts a milestone's tasks in its progress", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["milestone", "create", "v1"], { cwd: root });
      await runCli(["create", "a task"], { cwd: root });
      await runCli(["set", "T-1", "milestone", "v1"], { cwd: root });

      // The user-visible symptom: a milestone holding a task reported
      // 0/0, because the denominator counts by id and the task stored a
      // name.
      const list = await runCli(["milestone", "list", "--progress"], { cwd: root });
      expect(list.stdout).toMatch(/v1\s+0\/1/);
    });
  });

  it("stores a sprint id when set by name, and the burndown sees it", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(
        ["sprint", "create", "Alpha", "--start", "2026-05-04", "--end", "2026-05-08", "--state", "active"],
        { cwd: root },
      );
      await runCli(["create", "a task"], { cwd: root });
      await runCli(["set", "T-1", "sprint", "Alpha"], { cwd: root });

      const id = await idOf(root, "sprints.yaml", "Alpha");
      expect(await taskFile(root)).toContain(`sprint: ${id}`);

      // The burndown resolves the same sprint the task now points at.
      // Not asserting a total: `initialTotal` is the total at the
      // sprint's *start*, and a task created today did not exist then —
      // so 0 is correct here and asserting 1 would be asserting a bug.
      // The totals themselves are covered by burndown.test.ts, which
      // controls created_at.
      const bd = await runCli(["sprint", "burndown", "Alpha"], { cwd: root });
      expect(bd.exitCode).toBe(0);
      expect(bd.stdout).toContain(id);
    });
  });

  it("still accepts an id directly", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["milestone", "create", "v1"], { cwd: root });
      await runCli(["create", "a task"], { cwd: root });
      const id = await idOf(root, "milestones.yaml", "v1");

      const set = await runCli(["set", "T-1", "milestone", id], { cwd: root });
      expect(set.exitCode).toBe(0);
      expect(await taskFile(root)).toContain(`milestone: ${id}`);
    });
  });

  it("refuses an unknown milestone rather than storing the typo", async () => {
    await withTmpLoctt(async ({ root }) => {
      await runCli(["create", "a task"], { cwd: root });
      const set = await runCli(["set", "T-1", "milestone", "nope"], { cwd: root });
      expect(set.exitCode).not.toBe(0);
      expect(await taskFile(root)).not.toContain("milestone:");
    });
  });
});
