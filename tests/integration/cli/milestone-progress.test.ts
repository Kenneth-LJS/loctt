import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

  it("fails one milestone's progress inline while others list normally (MSL-35)", async () => {
    // Parity with core: a member of milestone A is unreadable but its
    // `milestone:` line is intact, so it is attributed to A. A reads
    // "(progress unavailable)" IN PLACE of its numbers, while B keeps its
    // real done/total on the same list — the per-milestone failure the
    // documented ceiling blocked.
    // @verifies MSL-35
    await withTmpLoctt(async ({ root }) => {
      const a = await setup(root);
      // A second milestone, resolved from the --ids listing.
      await runCli(["milestone", "create", "v2"], { cwd: root });
      const idsOut = await runCli(["milestone", "list", "--ids"], { cwd: root });
      const b = /v2\s+(\w{26})/.exec(idsOut.stdout)?.[1];
      expect(b, "milestone v2 id").toBeTruthy();

      // B: one done task ⇒ 1/1 real numbers.
      await task(root, "b-done", b!, "done");
      // A: one done + one that we then corrupt into an unreadable-but-
      // attributable member.
      await task(root, "a-done", a, "done");
      const badKey = await task(root, "a-broken", a);

      // Locate the corrupt member's task.md by finding the dir whose file
      // carries that key, then make it object-fatal (a wrong-typed `id`)
      // while leaving the `milestone:` line intact so it attributes to A.
      const tasksDir = path.join(root, ".loctt", "tasks");
      const dirs = await readdir(tasksDir);
      let corrupted = false;
      for (const d of dirs) {
        const file = path.join(tasksDir, d, "task.md");
        const raw = await readFile(file, "utf8");
        if (raw.includes(`key: ${badKey}`)) {
          await writeFile(
            file,
            `---\nid:\n  broken: mapping\nkey: ${badKey}\nmilestone: ${a}\n---\nbody\n`,
            "utf8",
          );
          corrupted = true;
          break;
        }
      }
      expect(corrupted, "found and corrupted the member").toBe(true);

      const out = await runCli(["milestone", "list", "--progress"], { cwd: root });
      expect(out.exitCode).toBe(0);
      // The affected milestone reads unavailable, not a plausible 1/1.
      expect(out.stdout).toMatch(/v1.*progress unavailable/);
      // The other milestone still lists its real numbers on the same run.
      expect(out.stdout).toMatch(/v2.*1\/1/);
    });
  });
});
