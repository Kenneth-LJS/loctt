import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt milestone list --progress` (item 11).
 *
 * Milestone progress existed nowhere — ten UI cases were written
 * against it. The load-bearing rules (flow-milestones-labels.md):
 * progress comes from status CATEGORY, never a status key, and
 * discarded tasks are excluded from the denominator.
 */
describe("CLI milestone progress (spawned binary)", () => {
  async function setup(root: string): Promise<string> {
    const created = await runCli(["milestone", "create", "v1"], { cwd: root });
    expect(created.exitCode).toBe(0);
    const ids = await runCli(["milestone", "list", "--ids"], { cwd: root });
    const id = /\s(\w{26})/.exec(ids.stdout)?.[1];
    expect(id, "milestone id").toBeTruthy();
    return id!;
  }

  async function task(root: string, title: string, milestone: string, status?: string) {
    const c = await runCli(["create", title], { cwd: root });
    const key = /Created\s+(\S+):/.exec(c.stdout)?.[1];
    await runCli(["set", key!, "milestone", milestone], { cwd: root });
    if (status) await runCli(["set", key!, "status", status], { cwd: root });
    return key!;
  }

  it("omits progress unless --progress is passed", async () => {
    await withTmpLoctt(async ({ root }) => {
      const id = await setup(root);
      await task(root, "a", id, "done");
      const out = await runCli(["milestone", "list"], { cwd: root });
      expect(out.stdout).toContain("v1");
      expect(out.stdout).not.toMatch(/\d+\/\d+/);
    });
  });

  it("reports done/total from status category", async () => {
    await withTmpLoctt(async ({ root }) => {
      const id = await setup(root);
      await task(root, "shipped", id, "done");
      await task(root, "outstanding", id);

      const out = await runCli(["milestone", "list", "--progress"], { cwd: root });
      expect(out.exitCode).toBe(0);
      expect(out.stdout).toContain("1/2");
    });
  });

  it("excludes discarded tasks from the denominator and says so", async () => {
    // 1 done + 1 outstanding + 1 discarded reads 1/2, not 1/3 — and
    // the exclusion is named where the number is shown, because
    // silently shrinking a denominator is its own confusion.
    await withTmpLoctt(async ({ root }) => {
      const id = await setup(root);
      await task(root, "shipped", id, "done");
      await task(root, "outstanding", id);
      await task(root, "dropped", id, "wont_do");

      const out = await runCli(["milestone", "list", "--progress"], { cwd: root });
      expect(out.stdout).toContain("1/2");
      expect(out.stdout).toContain("discarded");
    });
  });

  it("reads complete when all remaining work is discarded", async () => {
    await withTmpLoctt(async ({ root }) => {
      const id = await setup(root);
      await task(root, "shipped", id, "done");
      await task(root, "dropped", id, "wont_do");
      const out = await runCli(["milestone", "list", "--progress"], { cwd: root });
      expect(out.stdout).toContain("1/1");
    });
  });

  it("shows 0/0 for a milestone with no tasks", async () => {
    await withTmpLoctt(async ({ root }) => {
      await setup(root);
      const out = await runCli(["milestone", "list", "--progress"], { cwd: root });
      expect(out.stdout).toContain("0/0");
    });
  });
});
