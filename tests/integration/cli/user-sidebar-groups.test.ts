import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt user sidebar-groups` (SHL-45).
 *
 * The web sidebar-groups editor is a core capability; Ken's layer rule
 * puts it on CLI + MCP too. This exercises the CLI surface against the
 * spawned binary and the file on disk.
 */

async function settingsPath(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  return path.join(usersDir, String(id), "settings.yaml");
}

describe("CLI user sidebar-groups (spawned binary)", () => {
  // @verifies SHL-45
  it("prints the resolved order, all visible, by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["user", "sidebar-groups"], { cwd: root });
      expect(result.exitCode).toBe(0);
      // Default order includes every built-in group, marked visible.
      expect(result.stdout).toContain("projects\tvisible");
      expect(result.stdout).toContain("labels\tvisible");
    });
  });

  // @verifies SHL-45
  it("sets order + hidden and persists them to settings.yaml", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["user", "sidebar-groups", "--order", "labels,projects", "--hidden", "sprints"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      // Labels leads the printed order now, and sprints reads hidden.
      expect(result.stdout.indexOf("labels")).toBeLessThan(result.stdout.indexOf("projects"));
      expect(result.stdout).toContain("sprints\thidden");

      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).toContain("sidebar_groups");
      expect(file).toContain("labels");
      expect(file).toContain("sprints");
    });
  });

  // @verifies SHL-45 — a WRITE rejects an unknown id (B2 bug 4)
  it("rejects an unknown id with an error naming it, writing nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["user", "sidebar-groups", "--order", "labels,bogus,projects"],
        { cwd: root },
      );
      // A typo must not silently no-op: non-zero exit, the bad id named,
      // and no partial write.
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("bogus");
      const file = await readFile(await settingsPath(root), "utf8").catch(() => "");
      expect(file).not.toContain("sidebar_groups");
    });
  });

  // @verifies SHL-45 — a duplicate id is folded, not rejected
  it("de-duplicates a repeated (valid) id without erroring", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["user", "sidebar-groups", "--order", "labels,labels,projects"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).toContain("labels");
      expect(file).toContain("projects");
    });
  });

  // @verifies SHL-45 — the read round-trips a hidden FILTER, not just
  // groups (B2 bug 3): `--hidden overdue` must read back hidden.
  it("round-trips a hidden built-in filter through read", async () => {
    await withTmpLoctt(async ({ root }) => {
      const set = await runCli(
        ["user", "sidebar-groups", "--hidden", "overdue"],
        { cwd: root },
      );
      expect(set.exitCode).toBe(0);
      // The write's own read-back must show the filter hidden...
      expect(set.stdout).toContain("overdue\thidden");
      // ...and a fresh read (no flags) must too — the filter is not
      // dropped just because it is not a top-level group.
      const read = await runCli(["user", "sidebar-groups"], { cwd: root });
      expect(read.stdout).toContain("overdue\thidden");
    });
  });

  // @verifies SHL-45
  it("resets the setting back to the default", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        await settingsPath(root),
        "theme: dark\nsidebar_groups:\n  hidden: [labels]\n",
        "utf8",
      );
      const result = await runCli(["user", "sidebar-groups", "--reset"], { cwd: root });
      expect(result.exitCode).toBe(0);
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).not.toContain("sidebar_groups");
      // The unrelated preference survives the reset.
      expect(file).toContain("theme: dark");
    });
  });
});
