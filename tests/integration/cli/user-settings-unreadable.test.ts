import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * An unreadable `settings.yaml` on the CLI (B56, G12).
 *
 * The file does not parse, so the loader reads it as no settings: every
 * settings read keeps working at the defaults. A settings write refuses,
 * names the file and leaves it as it is, because writing would replace
 * the user's file with the defaults plus one change.
 */

const BROKEN = "theme: [dark\nkeyboard_shortcuts:\n  disabled: [new-task]\n";

async function breakSettings(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  const file = path.join(usersDir, String(id), "settings.yaml");
  await writeFile(file, BROKEN, "utf-8");
  return file;
}

describe("CLI with an unreadable settings.yaml (spawned binary)", () => {
  // @verifies DEG-C9
  it("reads the defaults: user settings, sidebar-groups, shortcuts, and create", async () => {
    await withTmpLoctt(async ({ root }) => {
      await breakSettings(root);

      const settings = await runCli(["user", "settings"], { cwd: root });
      expect(settings.exitCode).toBe(0);
      expect(settings.stdout).toContain("No personal settings.");

      const groups = await runCli(["user", "sidebar-groups"], { cwd: root });
      expect(groups.exitCode).toBe(0);
      expect(groups.stdout).toContain("projects\tvisible");

      const shortcuts = await runCli(["user", "shortcuts"], { cwd: root });
      expect(shortcuts.exitCode).toBe(0);
      expect(shortcuts.stdout).toContain("single-key\ton");

      // `create` reads the settings for the user's default project.
      const created = await runCli(["create", "Still works"], { cwd: root });
      expect(created.exitCode).toBe(0);
    });
  });

  // @verifies DEG-C9
  it("refuses a settings write, naming the file and leaving it as it is", async () => {
    await withTmpLoctt(async ({ root }) => {
      const file = await breakSettings(root);
      for (const args of [
        ["user", "sidebar-groups", "--hidden", "sprints"],
        ["user", "sidebar-groups", "--reset"],
        ["user", "shortcuts", "--off", "new-task"],
      ]) {
        const result = await runCli(args, { cwd: root });
        expect(result.exitCode, args.join(" ")).not.toBe(0);
        expect(result.stderr).toContain("settings.yaml");
        expect(result.stderr).toContain("weren't saved");
        expect(await readFile(file, "utf-8")).toBe(BROKEN);
      }
    });
  });
});
