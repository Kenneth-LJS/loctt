import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * `loctt user shortcuts` (K133, A11Y-43): the CLI surface of the web
 * Keyboard switches. Exercised against the spawned binary and the file
 * on disk (the far end), so a print that disagrees with the file fails.
 */

async function settingsPath(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const [id] = await readdir(usersDir);
  return path.join(usersDir, String(id), "settings.yaml");
}

describe("CLI user shortcuts (spawned binary)", () => {
  // @verifies PRU-C13
  it("prints every shortcut on by default", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["user", "shortcuts"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("single-key\ton");
      expect(result.stdout).toContain("new-task\tn\ton\tCreate a task");
      expect(result.stdout).toContain("goto\tg l, g b, g t\ton");
    });
  });

  // @verifies PRU-C13
  // @verifies A11Y-43
  it("turns the master and one shortcut off, writing the file the app reads", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(
        ["user", "shortcuts", "--single-key", "off", "--off", "goto", "--off", "new-task"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("single-key\toff");
      expect(result.stdout).toContain("goto\tg l, g b, g t\toff");
      expect(result.stdout).toContain("cycle-theme\tt\ton");

      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).toMatch(/keyboard_shortcuts:\s*\n\s+single_key: false\s*\n\s+disabled:\s*\n\s+- new-task\s*\n\s+- goto/);

      const back = await runCli(["user", "shortcuts", "--single-key", "on", "--on", "goto"], { cwd: root });
      expect(back.stdout).toContain("single-key\ton");
      expect(back.stdout).toContain("goto\tg l, g b, g t\ton");
      expect(back.stdout).toContain("new-task\tn\toff");
    });
  });

  // @verifies PRU-C13
  it("refuses an unknown id, naming it, and writes nothing", async () => {
    await withTmpLoctt(async ({ root }) => {
      const before = await readFile(await settingsPath(root), "utf8").catch(() => "");
      const result = await runCli(["user", "shortcuts", "--off", "goto,bogus"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("bogus");
      expect(result.stderr).toContain("new-task");
      const after = await readFile(await settingsPath(root), "utf8").catch(() => "");
      expect(after).toBe(before);
    });
  });

  // @verifies PRU-C13
  it("--reset turns everything back on and keeps other settings", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        await settingsPath(root),
        "theme: dark\nkeyboard_shortcuts:\n  single_key: false\n  disabled: [goto]\n",
        "utf8",
      );
      const result = await runCli(["user", "shortcuts", "--reset"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("single-key\ton");
      const file = await readFile(await settingsPath(root), "utf8");
      expect(file).not.toContain("keyboard_shortcuts");
      expect(file).toContain("theme: dark");
    });
  });

  // @verifies PRU-C13
  it("reads a hand-corrupted value degraded, not crashed", async () => {
    await withTmpLoctt(async ({ root }) => {
      await writeFile(
        await settingsPath(root),
        "keyboard_shortcuts:\n  single_key: false\n  disabled: [goto, bogus]\n",
        "utf8",
      );
      const result = await runCli(["user", "shortcuts"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("single-key\toff");
      expect(result.stdout).toContain("goto\tg l, g b, g t\toff");
    });
  });
});
