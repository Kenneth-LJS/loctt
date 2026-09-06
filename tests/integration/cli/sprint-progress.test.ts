import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt sprint list --progress` (F1 / K30 parity).
 *
 * Sprint progress existed only on the web server — no CLI flag, no MCP
 * arg, no web client. This mirrors `milestone list --progress`: the
 * load-bearing rules are the same — progress comes from status
 * CATEGORY (never a status key), and discarded tasks are excluded from
 * the denominator.
 */
describe("CLI sprint progress (spawned binary)", () => {
  async function setup(root: string): Promise<string> {
    const created = await runCli(
      ["sprint", "create", "s1", "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active"],
      { cwd: root },
    );
    expect(created.exitCode).toBe(0);
    const ids = await runCli(["sprint", "list", "--ids"], { cwd: root });
    const id = /\s(\w{26})/.exec(ids.stdout)?.[1];
    expect(id, "sprint id").toBeTruthy();
    return id!;
  }

  async function task(root: string, title: string, sprint: string, status?: string) {
    const c = await runCli(["create", title], { cwd: root });
    const key = /Created\s+(\S+):/.exec(c.stdout)?.[1];
    await runCli(["set", key!, "sprint", sprint], { cwd: root });
    if (status) await runCli(["set", key!, "status", status], { cwd: root });
    return key!;
  }

  it("omits progress unless --progress is passed", async () => {
    await withTmpLoctt(async ({ root }) => {
      const id = await setup(root);
      await task(root, "a", id, "done");
      const out = await runCli(["sprint", "list"], { cwd: root });
      expect(out.stdout).toContain("s1");
      expect(out.stdout).not.toMatch(/\d+\/\d+/);
    });
  });

  it("reports done/total from status category", async () => {
    await withTmpLoctt(async ({ root }) => {
      const id = await setup(root);
      await task(root, "shipped", id, "done");
      await task(root, "outstanding", id);

      const out = await runCli(["sprint", "list", "--progress"], { cwd: root });
      expect(out.exitCode).toBe(0);
      expect(out.stdout).toContain("1/2");
    });
  });

  it("excludes discarded tasks from the denominator and says so", async () => {
    // 1 done + 1 outstanding + 1 discarded reads 1/2, not 1/3 — and the
    // exclusion is named where the number is shown, mirroring milestones.
    await withTmpLoctt(async ({ root }) => {
      const id = await setup(root);
      await task(root, "shipped", id, "done");
      await task(root, "outstanding", id);
      await task(root, "dropped", id, "wont_do");

      const out = await runCli(["sprint", "list", "--progress"], { cwd: root });
      expect(out.stdout).toContain("1/2");
      expect(out.stdout).toContain("discarded");
    });
  });

  it("shows 0/0 for a sprint with no tasks", async () => {
    await withTmpLoctt(async ({ root }) => {
      await setup(root);
      const out = await runCli(["sprint", "list", "--progress"], { cwd: root });
      expect(out.stdout).toContain("0/0");
    });
  });
});
